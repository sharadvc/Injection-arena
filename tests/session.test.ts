import { describe, expect, it } from "vitest";
import {
  createSession,
  encodeSession,
  decodeSession,
  sanitizeNickname,
} from "@/lib/session";
import { rateLimit, _resetRateLimiter } from "@/lib/ratelimit";

describe("session signing", () => {
  it("round-trips a signed session", () => {
    const s = createSession("Royal");
    const cookie = encodeSession(s);
    const back = decodeSession(cookie);
    expect(back).toEqual(s);
  });

  it("rejects a tampered cookie", () => {
    const cookie = encodeSession(createSession("Royal"));
    const tampered = cookie.slice(0, -2) + "xy";
    expect(decodeSession(tampered)).toBeNull();
  });

  it("sanitizes hostile nicknames", () => {
    expect(sanitizeNickname("  <script>alert(1)</script>  ")).not.toContain("<");
    expect(sanitizeNickname("")).toMatch(/^anon-/);
  });
});

describe("rate limiter", () => {
  it("allows up to the limit then blocks", () => {
    _resetRateLimiter();
    const key = "rl-test";
    for (let i = 0; i < 3; i++) {
      expect(rateLimit(key, 3, 60_000).allowed).toBe(true);
    }
    expect(rateLimit(key, 3, 60_000).allowed).toBe(false);
  });

  it("falls back to default limit when RATE_LIMIT_MAX is not a number", () => {
    _resetRateLimiter();
    const prev = process.env.RATE_LIMIT_MAX;
    process.env.RATE_LIMIT_MAX = "abc";
    try {
      const key = "rl-invalid-env";
      for (let i = 0; i < 20; i++) {
        expect(rateLimit(key).allowed).toBe(true);
      }
      expect(rateLimit(key).allowed).toBe(false);
    } finally {
      if (prev === undefined) delete process.env.RATE_LIMIT_MAX;
      else process.env.RATE_LIMIT_MAX = prev;
      _resetRateLimiter();
    }
  });
});
