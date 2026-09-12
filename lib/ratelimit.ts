// Fixed-window in-memory rate limiter for the attempt endpoint. Keyed by
// session id (falling back to IP). Good enough for a single-node self-host; swap
// for Redis if you run multiple instances.

interface Window {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Window>();

const DEFAULT_LIMIT = 20;
const DEFAULT_WINDOW_MS = 60_000;

function parseEnvPositiveInt(
  raw: string | undefined,
  fallback: number,
): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function resolveLimit(limit?: number): number {
  if (limit !== undefined) {
    return Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : DEFAULT_LIMIT;
  }
  return parseEnvPositiveInt(process.env.RATE_LIMIT_MAX, DEFAULT_LIMIT);
}

function resolveWindowMs(windowMs?: number): number {
  if (windowMs !== undefined) {
    return Number.isFinite(windowMs) && windowMs > 0
      ? Math.floor(windowMs)
      : DEFAULT_WINDOW_MS;
  }
  return parseEnvPositiveInt(
    process.env.RATE_LIMIT_WINDOW_MS,
    DEFAULT_WINDOW_MS,
  );
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
}

export function rateLimit(
  key: string,
  limit?: number,
  windowMs?: number,
): RateLimitResult {
  const effectiveLimit = resolveLimit(limit);
  const effectiveWindowMs = resolveWindowMs(windowMs);
  const now = Date.now();
  const existing = buckets.get(key);

  if (!existing || now >= existing.resetAt) {
    const win = { count: 1, resetAt: now + effectiveWindowMs };
    buckets.set(key, win);
    return {
      allowed: true,
      remaining: effectiveLimit - 1,
      resetAt: win.resetAt,
    };
  }

  if (existing.count >= effectiveLimit) {
    return { allowed: false, remaining: 0, resetAt: existing.resetAt };
  }

  existing.count += 1;
  return {
    allowed: true,
    remaining: effectiveLimit - existing.count,
    resetAt: existing.resetAt,
  };
}

/** Test helper to reset all buckets. */
export function _resetRateLimiter(): void {
  buckets.clear();
}
