import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type BetterSqlite3 from "better-sqlite3";
import type { AttemptRecord, LeaderboardRow, VerdictReason } from "./types";

// Async, dual-backend persistence for attempts and the leaderboard.
//
// Two interchangeable backends sit behind one async interface:
//
//   - better-sqlite3 (synchronous under the hood, wrapped as async): used by
//     `next dev`, `next build` on Node, and the test suite. DB path is
//     configurable via DATABASE_PATH; tests use an in-memory database.
//   - Cloudflare D1 (natively async): used in production on Workers, reached
//     through the `DB` binding via @opennextjs/cloudflare's Cloudflare context.
//
// The backend is chosen at runtime: if a D1 binding is present (production
// Workers runtime) it wins; otherwise we fall back to better-sqlite3. Importing
// this module never touches native or Worker-only code at the top level, so it
// stays safe to import from vitest and from a plain Node context.

export interface RecordAttemptInput {
  sessionId: string;
  nickname: string;
  challengeId: string;
  input: string;
  cracked: boolean;
  reason: VerdictReason;
  points: number;
}

/** The storage contract every backend implements. All methods are async. */
interface DbBackend {
  recordAttempt(input: RecordAttemptInput): Promise<AttemptRecord>;
  countAttempts(sessionId: string, challengeId: string): Promise<number>;
  hasCracked(sessionId: string, challengeId: string): Promise<boolean>;
  getLeaderboard(limit: number): Promise<LeaderboardRow[]>;
  getSessionAttempts(sessionId: string): Promise<AttemptRecord[]>;
}

// Shared schema (D1-compatible: no WAL or other unsupported pragmas here).
const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS attempts (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id  TEXT NOT NULL,
    nickname    TEXT NOT NULL,
    challenge_id TEXT NOT NULL,
    input       TEXT NOT NULL,
    cracked     INTEGER NOT NULL,
    reason      TEXT NOT NULL,
    points      INTEGER NOT NULL,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_attempts_session ON attempts(session_id);
  CREATE INDEX IF NOT EXISTS idx_attempts_challenge ON attempts(challenge_id);
`;

const COUNT_SQL =
  "SELECT COUNT(*) AS n FROM attempts WHERE session_id = ? AND challenge_id = ?";
const CRACKED_SQL =
  "SELECT COUNT(*) AS n FROM attempts WHERE session_id = ? AND challenge_id = ? AND cracked = 1";
const INSERT_SQL = `INSERT INTO attempts (session_id, nickname, challenge_id, input, cracked, reason, points)
   VALUES (?, ?, ?, ?, ?, ?, ?)`;
const BY_ID_SQL = "SELECT * FROM attempts WHERE id = ?";
const LEADERBOARD_SQL = `SELECT
     nickname,
     session_id AS sessionId,
     SUM(points) AS totalPoints,
     SUM(cracked) AS levelsCracked,
     COUNT(*) AS attempts
   FROM attempts
   GROUP BY session_id
   ORDER BY totalPoints DESC, levelsCracked DESC, attempts ASC
   LIMIT ?`;
const SESSION_ATTEMPTS_SQL =
  "SELECT * FROM attempts WHERE session_id = ? ORDER BY created_at DESC";

// ---------------------------------------------------------------------------
// better-sqlite3 backend (local + test)
// ---------------------------------------------------------------------------

// Loaded via createRequire so the native module is never statically bundled by
// the Cloudflare/OpenNext build, where this code path is unreachable anyway.
function loadBetterSqlite3(): typeof BetterSqlite3 {
  const require = createRequire(import.meta.url);
  return require("better-sqlite3");
}

function migrateSqlite(conn: BetterSqlite3.Database): void {
  conn.pragma("journal_mode = WAL");
  conn.exec(SCHEMA_SQL);
}

function makeSqliteBackend(conn: BetterSqlite3.Database): DbBackend {
  return {
    async recordAttempt(input) {
      const info = conn
        .prepare(INSERT_SQL)
        .run(
          input.sessionId,
          input.nickname,
          input.challengeId,
          input.input,
          input.cracked ? 1 : 0,
          input.reason,
          input.points,
        );
      return conn
        .prepare(BY_ID_SQL)
        .get(info.lastInsertRowid) as unknown as AttemptRecord;
    },
    async countAttempts(sessionId, challengeId) {
      const row = conn.prepare(COUNT_SQL).get(sessionId, challengeId) as {
        n: number;
      };
      return row.n;
    },
    async hasCracked(sessionId, challengeId) {
      const row = conn.prepare(CRACKED_SQL).get(sessionId, challengeId) as {
        n: number;
      };
      return row.n > 0;
    },
    async getLeaderboard(limit) {
      return conn
        .prepare(LEADERBOARD_SQL)
        .all(limit) as unknown as LeaderboardRow[];
    },
    async getSessionAttempts(sessionId) {
      return conn
        .prepare(SESSION_ATTEMPTS_SQL)
        .all(sessionId) as unknown as AttemptRecord[];
    },
  };
}

function resolvePath(): string {
  return process.env.DATABASE_PATH || resolve(process.cwd(), "data/arena.db");
}

// Cached file-backed connection (also stashed on globalThis in dev so it
// survives Next.js hot reloads).
const globalForDb = globalThis as unknown as {
  __arenaSqlite?: BetterSqlite3.Database;
};

function getFileSqliteBackend(): DbBackend {
  let conn = globalForDb.__arenaSqlite;
  if (!conn) {
    const path = resolvePath();
    if (path !== ":memory:") {
      mkdirSync(dirname(path), { recursive: true });
    }
    const Database = loadBetterSqlite3();
    conn = new Database(path);
    migrateSqlite(conn);
    globalForDb.__arenaSqlite = conn;
  }
  return makeSqliteBackend(conn);
}

// ---------------------------------------------------------------------------
// Cloudflare D1 backend (production)
// ---------------------------------------------------------------------------

function makeD1Backend(d1: D1Database): DbBackend {
  return {
    async recordAttempt(input) {
      const res = await d1
        .prepare(INSERT_SQL)
        .bind(
          input.sessionId,
          input.nickname,
          input.challengeId,
          input.input,
          input.cracked ? 1 : 0,
          input.reason,
          input.points,
        )
        .run();
      const id = res.meta.last_row_id;
      const row = await d1.prepare(BY_ID_SQL).bind(id).first();
      return row as unknown as AttemptRecord;
    },
    async countAttempts(sessionId, challengeId) {
      const row = await d1
        .prepare(COUNT_SQL)
        .bind(sessionId, challengeId)
        .first<{ n: number }>();
      return row?.n ?? 0;
    },
    async hasCracked(sessionId, challengeId) {
      const row = await d1
        .prepare(CRACKED_SQL)
        .bind(sessionId, challengeId)
        .first<{ n: number }>();
      return (row?.n ?? 0) > 0;
    },
    async getLeaderboard(limit) {
      const res = await d1
        .prepare(LEADERBOARD_SQL)
        .bind(limit)
        .all<LeaderboardRow>();
      return res.results ?? [];
    },
    async getSessionAttempts(sessionId) {
      const res = await d1
        .prepare(SESSION_ATTEMPTS_SQL)
        .bind(sessionId)
        .all<AttemptRecord>();
      return res.results ?? [];
    },
  };
}

/**
 * Look up the D1 binding via the Cloudflare context. Returns null (rather than
 * throwing) whenever we are not running on the Workers runtime, e.g. in tests,
 * `next dev`, or a plain Node process, so callers can fall back cleanly.
 */
async function getD1Binding(): Promise<D1Database | null> {
  try {
    const mod = await import("@opennextjs/cloudflare");
    const env = mod.getCloudflareContext().env as Partial<CloudflareEnv>;
    return env.DB ?? null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Backend selection
// ---------------------------------------------------------------------------

// Explicit override installed by useInMemoryDb() for tests; always wins.
let overrideBackend: DbBackend | null = null;
// Cached resolution for the normal (non-test) path.
let backendPromise: Promise<DbBackend> | null = null;

async function resolveBackend(): Promise<DbBackend> {
  const d1 = await getD1Binding();
  if (d1) return makeD1Backend(d1);
  return getFileSqliteBackend();
}

function getBackend(): Promise<DbBackend> {
  if (overrideBackend) return Promise.resolve(overrideBackend);
  if (!backendPromise) backendPromise = resolveBackend();
  return backendPromise;
}

/**
 * Test helper: use an isolated in-memory better-sqlite3 database. Stays
 * synchronous so it can be used directly in a vitest `beforeEach`.
 */
export function useInMemoryDb(): BetterSqlite3.Database {
  const Database = loadBetterSqlite3();
  const conn = new Database(":memory:");
  migrateSqlite(conn);
  overrideBackend = makeSqliteBackend(conn);
  backendPromise = null;
  return conn;
}

// ---------------------------------------------------------------------------
// Public async API
// ---------------------------------------------------------------------------

/** Number of attempts a session has already made on a given challenge. */
export async function countAttempts(
  sessionId: string,
  challengeId: string,
): Promise<number> {
  return (await getBackend()).countAttempts(sessionId, challengeId);
}

/** Whether a session has already cracked a challenge (first crack scores). */
export async function hasCracked(
  sessionId: string,
  challengeId: string,
): Promise<boolean> {
  return (await getBackend()).hasCracked(sessionId, challengeId);
}

export async function recordAttempt(
  input: RecordAttemptInput,
): Promise<AttemptRecord> {
  return (await getBackend()).recordAttempt(input);
}

const DEFAULT_LEADERBOARD_LIMIT = 50;

function normalizeLeaderboardLimit(limit: number): number {
  if (!Number.isFinite(limit) || limit < 1) {
    return DEFAULT_LEADERBOARD_LIMIT;
  }
  return Math.floor(limit);
}

export async function getLeaderboard(
  limit = DEFAULT_LEADERBOARD_LIMIT,
): Promise<LeaderboardRow[]> {
  return (await getBackend()).getLeaderboard(normalizeLeaderboardLimit(limit));
}

export async function getSessionAttempts(
  sessionId: string,
): Promise<AttemptRecord[]> {
  return (await getBackend()).getSessionAttempts(sessionId);
}
