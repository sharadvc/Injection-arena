import { describe, expect, it } from "vitest";
import { scoreCrack, scoreFail, BASE_PER_DIFFICULTY, DEFENSE_BONUS } from "@/lib/scoring";
import { getChallenge } from "@/lib/challenges/levels";

describe("scoring", () => {
  const level1 = getChallenge("level-1-open-book")!;
  const level10 = getChallenge("level-10-final")!;

  it("failed attempts score zero", () => {
    expect(scoreFail()).toBe(0);
  });

  it("first-try crack of level 1 equals base + defense bonus", () => {
    const expected =
      level1.difficulty * BASE_PER_DIFFICULTY +
      level1.defenses.length * DEFENSE_BONUS;
    expect(scoreCrack(level1, 0)).toBe(expected);
  });

  it("harder levels are worth more than easier ones on first try", () => {
    expect(scoreCrack(level10, 0)).toBeGreaterThan(scoreCrack(level1, 0));
  });

  it("efficiency decays with prior attempts but never below 40%", () => {
    const first = scoreCrack(level10, 0);
    const later = scoreCrack(level10, 3);
    const floor = scoreCrack(level10, 100);
    expect(later).toBeLessThan(first);
    expect(floor).toBeGreaterThanOrEqual(Math.round(first * 0.4) - 1);
  });

  it("negative priorAttempts cannot score above first try", () => {
    const firstTry = scoreCrack(level1, 0);
    expect(scoreCrack(level1, -1)).toBe(firstTry);
    expect(scoreCrack(level1, -5)).toBe(firstTry);
  });

  it("non-finite priorAttempts never yields NaN score", () => {
    const firstTry = scoreCrack(level1, 0);
    expect(Number.isNaN(scoreCrack(level1, NaN))).toBe(false);
    expect(scoreCrack(level1, NaN)).toBe(firstTry);
  });
});
