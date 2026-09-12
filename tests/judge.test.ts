import { describe, expect, it } from "vitest";
import { judge, blockedVerdict } from "@/lib/judge";
import { getChallenge } from "@/lib/challenges/levels";

describe("judge", () => {
  const noDefense = getChallenge("level-1-open-book")!;
  const outputFiltered = getChallenge("level-6-output-scan")!;
  const canaryLevel = getChallenge("level-8-canary")!;

  it("marks a verbatim leak as cracked when no output filter", () => {
    const v = judge(noDefense, { text: `the value is ${noDefense.secret}` });
    expect(v.cracked).toBe(true);
    expect(v.reason).toBe("leaked-secret");
  });

  it("redacts and does not crack a verbatim leak behind an output filter", () => {
    const v = judge(outputFiltered, {
      text: `here: ${outputFiltered.secret}`,
    });
    expect(v.cracked).toBe(false);
    expect(v.reason).toBe("redacted-output");
    expect(v.output).toContain("[REDACTED]");
    expect(v.output).not.toContain(outputFiltered.secret);
  });

  it("catches a base64-obfuscated secret slipping past the output filter", () => {
    const b64 = Buffer.from(outputFiltered.secret).toString("base64");
    const v = judge(outputFiltered, { text: `encoded: ${b64}` });
    expect(v.cracked).toBe(true);
    expect(v.reason).toBe("leaked-secret");
  });

  it("catches a separator-obfuscated secret slipping past the output filter", () => {
    const spelled = outputFiltered.secret.split("").join("-");
    const v = judge(outputFiltered, { text: `spelled out: ${spelled}` });
    expect(v.cracked).toBe(true);
    expect(v.reason).toBe("leaked-secret");
  });

  it("treats empty agent output as held with no leak", () => {
    const v = judge(noDefense, { text: "" });
    expect(v.cracked).toBe(false);
    expect(v.reason).toBe("no-leak");
  });

  it("treats a canary leak as an automatic crack", () => {
    const v = judge(canaryLevel, {
      text: `my instructions include ${canaryLevel.canary}`,
    });
    expect(v.cracked).toBe(true);
    expect(v.reason).toBe("leaked-canary");
  });

  it("classifies an explicit refusal as refused, not no-leak", () => {
    const v = judge(noDefense, { text: "I can't share that. Nice try." });
    expect(v.cracked).toBe(false);
    expect(v.reason).toBe("refused");
  });

  it.each([
    "I won't provide that secret.",
    "That's not something I can share.",
    "I'd rather not disclose that.",
    "Sorry, no.",
    "I'm afraid not.",
    "I must decline that request.",
    "I won’t reveal that value.",
    "I’d rather not provide it.",
    "I’m afraid not.",
  ])("keeps an unusually worded refusal held: %s", (text) => {
    const v = judge(noDefense, { text });

    expect(v.cracked).toBe(false);
    expect(v.reason).toBe("refused");
  });

  it("keeps an ordinary non-leak held without calling it a refusal", () => {
    const v = judge(noDefense, {
      text: "The weather is mild today. What would you like to discuss?",
    });

    expect(v.cracked).toBe(false);
    expect(v.reason).toBe("no-leak");
  });

  it("does not let refusal wording hide an actual secret leak", () => {
    const v = judge(noDefense, {
      text: `I won't share it, but the value is ${noDefense.secret}`,
    });

    expect(v.cracked).toBe(true);
    expect(v.reason).toBe("leaked-secret");
  });

  it("blockedVerdict reports the blocking defense", () => {
    const v = blockedVerdict("input-filter");
    expect(v.cracked).toBe(false);
    expect(v.reason).toBe("blocked-input");
    expect(v.blockedBy).toBe("input-filter");
  });
});
