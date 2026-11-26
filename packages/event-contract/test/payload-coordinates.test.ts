import { describe, expect, it } from "vitest";

import { payloadCoordinateValidators } from "../src/payload-coordinates.js";

const hash = `sha256:${"a".repeat(64)}`;

describe("payload coordinate checks", () => {
  it("checks that an artifact ID names its content hash", () => {
    const check = payloadCoordinateValidators["knowledge.verified"]!;
    expect(
      check({ knowledgeArtifactId: `art_${"a".repeat(64)}`, knowledgeContentHash: hash }),
    ).toBe(true);
    expect(
      check({ knowledgeArtifactId: `art_${"b".repeat(64)}`, knowledgeContentHash: hash }),
    ).toBe(false);
  });

  it("checks counts against their lists", () => {
    const check = payloadCoordinateValidators["resource.usage.recorded"]!;
    const usage = {
      inputTokens: 10,
      cachedInputTokens: 4,
      outputTokens: 6,
      reasoningOutputTokens: 2,
    };
    expect(check({ usage: { ...usage, totalTokens: 16 } })).toBe(true);
    expect(check({ usage: { ...usage, totalTokens: 17 } })).toBe(false);
    expect(check({ usage: null })).toBe(true);
  });

  it("has no check for a type whose schema states every coordinate", () => {
    expect(payloadCoordinateValidators["execution.stages.observed"]).toBeUndefined();
  });
});
