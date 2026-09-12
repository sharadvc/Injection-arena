import { getAgent } from "./agent";
import { getChallenge } from "./challenges/levels";
import { runInputFilter } from "./defenses/input-filter";
import {
  countAttempts,
  hasCracked,
  recordAttempt,
} from "./db";
import { blockedVerdict, judge } from "./judge";
import { scoreCrack, scoreFail } from "./scoring";
import type { Session } from "./session";
import type { Verdict } from "./types";

// The end-to-end attempt pipeline, kept UI-agnostic so both the API route and
// the test suite drive the exact same logic:
//
//   input-filter -> agent -> judge -> score -> persist
//
// Scoring rule: only the *first* crack of a level by a session earns points;
// subsequent cracks and all failures earn zero.

export const MAX_ATTEMPT_INPUT = 4000;

export function validateAttemptInput(input: string): void {
  if (input.trim().length === 0) {
    throw new Error("input must not be empty or whitespace-only");
  }
  if (input.length > MAX_ATTEMPT_INPUT) {
    throw new Error(`input must be at most ${MAX_ATTEMPT_INPUT} characters`);
  }
}

export interface RunAttemptArgs {
  session: Session;
  challengeId: string;
  input: string;
  /** When true (tests), skip DB persistence and use provided priorAttempts. */
  dryRun?: boolean;
  priorAttempts?: number;
  alreadyCracked?: boolean;
}

export interface AttemptOutcome {
  verdict: Verdict;
  points: number;
  challengeId: string;
  challengeName: string;
  difficulty: number;
  firstCrack: boolean;
}

export async function runAttempt(args: RunAttemptArgs): Promise<AttemptOutcome> {
  const challenge = getChallenge(args.challengeId);
  if (!challenge) {
    throw new Error(`Unknown challenge: ${args.challengeId}`);
  }

  validateAttemptInput(args.input);

  const priorAttempts = args.dryRun
    ? args.priorAttempts ?? 0
    : await countAttempts(args.session.sessionId, challenge.id);
  const alreadyCracked = args.dryRun
    ? args.alreadyCracked ?? false
    : await hasCracked(args.session.sessionId, challenge.id);

  // Stage 1: input filter.
  const filter = runInputFilter(challenge, args.input);
  let verdict: Verdict;
  if (filter.blocked && filter.blockedBy) {
    verdict = blockedVerdict(filter.blockedBy);
  } else {
    // Stage 2: agent responds.
    const agent = getAgent();
    const response = await agent
      .respond({ challenge, userInput: args.input })
      .catch(() => undefined);
    if (response) {
      // Stage 3: judge grades the raw output.
      verdict = judge(challenge, response);
    } else {
      verdict = {
        cracked: false,
        reason: "provider-error",
        output: "The agent provider failed to respond. Please try again.",
      };
    }
  }

  // Stage 4: score.
  const firstCrack = verdict.cracked && !alreadyCracked;
  const points = firstCrack ? scoreCrack(challenge, priorAttempts) : scoreFail();

  // Stage 5: persist (unless dry run).
  if (!args.dryRun) {
    await recordAttempt({
      sessionId: args.session.sessionId,
      nickname: args.session.nickname,
      challengeId: challenge.id,
      input: args.input,
      cracked: verdict.cracked,
      reason: verdict.reason,
      points,
    });
  }

  return {
    verdict,
    points,
    challengeId: challenge.id,
    challengeName: challenge.name,
    difficulty: challenge.difficulty,
    firstCrack,
  };
}
