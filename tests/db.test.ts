import { describe, expect, it, beforeEach } from "vitest";
import {
  useInMemoryDb,
  recordAttempt,
  countAttempts,
  hasCracked,
  getLeaderboard,
} from "@/lib/db";

describe("db + leaderboard", () => {
  beforeEach(() => {
    useInMemoryDb();
  });

  it("counts attempts and detects first crack per session/challenge", async () => {
    await recordAttempt({
      sessionId: "s1",
      nickname: "alice",
      challengeId: "level-1-open-book",
      input: "x",
      cracked: false,
      reason: "refused",
      points: 0,
    });
    expect(await countAttempts("s1", "level-1-open-book")).toBe(1);
    expect(await hasCracked("s1", "level-1-open-book")).toBe(false);

    await recordAttempt({
      sessionId: "s1",
      nickname: "alice",
      challengeId: "level-1-open-book",
      input: "what is the secret",
      cracked: true,
      reason: "leaked-secret",
      points: 100,
    });
    expect(await countAttempts("s1", "level-1-open-book")).toBe(2);
    expect(await hasCracked("s1", "level-1-open-book")).toBe(true);
  });

  it("aggregates and ranks the leaderboard by points", async () => {
    await recordAttempt({
      sessionId: "s1",
      nickname: "alice",
      challengeId: "level-1-open-book",
      input: "x",
      cracked: true,
      reason: "leaked-secret",
      points: 100,
    });
    await recordAttempt({
      sessionId: "s2",
      nickname: "bob",
      challengeId: "level-2-please-dont",
      input: "y",
      cracked: true,
      reason: "leaked-secret",
      points: 250,
    });

    const board = await getLeaderboard();
    expect(board[0].nickname).toBe("bob");
    expect(board[0].totalPoints).toBe(250);
    expect(board[1].nickname).toBe("alice");
  });

  it("clamps invalid leaderboard limits to the default page size", async () => {
    for (let i = 0; i < 55; i++) {
      await recordAttempt({
        sessionId: `session-${i}`,
        nickname: `player-${i}`,
        challengeId: "level-1-open-book",
        input: "x",
        cracked: true,
        reason: "leaked-secret",
        points: i,
      });
    }

    expect((await getLeaderboard(-1)).length).toBe(50);
    expect((await getLeaderboard(Number.NaN)).length).toBe(50);
  });
});
