import { NextResponse } from "next/server";
import { runAttempt, validateAttemptInput } from "@/lib/arena";
import { getChallenge } from "@/lib/challenges/levels";
import { ensureSession } from "@/lib/http";
import { rateLimit } from "@/lib/ratelimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const session = ensureSession();

  // Rate limit per session (fallback to a shared bucket if session id missing).
  const rl = rateLimit(`attempt:${session.sessionId}`);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Rate limit exceeded. Slow down and try again shortly." },
      { status: 429, headers: { "retry-after": String(Math.ceil((rl.resetAt - Date.now()) / 1000)) } },
    );
  }

  const body = await req.json().catch(() => null);
  const challengeId = body?.challengeId;
  const input = body?.input;

  if (typeof challengeId !== "string" || typeof input !== "string") {
    return NextResponse.json(
      { error: "challengeId and input are required" },
      { status: 400 },
    );
  }
  try {
    validateAttemptInput(input);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "invalid input";
    return NextResponse.json({ error: message }, { status: 400 });
  }
  if (!getChallenge(challengeId)) {
    return NextResponse.json({ error: "unknown challenge" }, { status: 404 });
  }

  const outcome = await runAttempt({ session, challengeId, input });

  // Never leak internal fields; return only what the UI needs.
  return NextResponse.json({
    cracked: outcome.verdict.cracked,
    reason: outcome.verdict.reason,
    output: outcome.verdict.output,
    blockedBy: outcome.verdict.blockedBy ?? null,
    points: outcome.points,
    firstCrack: outcome.firstCrack,
    challengeName: outcome.challengeName,
    difficulty: outcome.difficulty,
    remaining: rl.remaining,
  });
}
