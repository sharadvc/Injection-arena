import type { Challenge } from "./types";

// Scoring rewards cracking harder levels and doing it with fewer attempts.
//
//   base            = difficulty * 100
//   efficiencyBonus = decays with the number of attempts already spent on the
//                     level, so the first crack is worth the most.
//   defenseBonus    = +25 per defense layer that was active.
//
// A failed attempt scores 0. Only the first successful crack of a level counts
// toward a session's total (enforced at persistence time).

export const BASE_PER_DIFFICULTY = 100;
export const DEFENSE_BONUS = 25;

/**
 * @param challenge the cracked challenge
 * @param priorAttempts number of attempts already made on this level before the
 *   successful one (0 = first try)
 */
export function scoreCrack(challenge: Challenge, priorAttempts: number): number {
  const base = challenge.difficulty * BASE_PER_DIFFICULTY;
  const defenseBonus = challenge.defenses.length * DEFENSE_BONUS;

  const safePriorAttempts = Number.isFinite(priorAttempts)
    ? Math.max(0, priorAttempts)
    : 0;

  // Efficiency multiplier: 1.0 on first try, decaying but never below 0.4.
  const efficiency = Math.max(0.4, 1 - safePriorAttempts * 0.1);

  return Math.round((base + defenseBonus) * efficiency);
}

/** Points for a failed attempt (always zero, kept explicit for clarity). */
export function scoreFail(): number {
  return 0;
}
