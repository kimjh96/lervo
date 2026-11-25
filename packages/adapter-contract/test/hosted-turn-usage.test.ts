import { describe, expect, it } from "vitest";

import { reportsUsage, usageModelName } from "../src/hosted-turn-usage.js";

describe("a usage record's model name", () => {
  it("keeps a provider's safe name, its context tier included", () => {
    expect(usageModelName("claude-haiku-5-5")).toBe("claude-haiku-5-5");
    expect(usageModelName("claude-opus-5-5[1m]")).toBe("claude-opus-5-5[1m]");
    expect(usageModelName("us.anthropic.claude-sonnet-5-5-v1:0")).toBe(
      "us.anthropic.claude-sonnet-5-5-v1:0",
    );
    expect(usageModelName("claude-sonnet-5-5@20261001")).toBe("claude-sonnet-5-5@20261001");
  });

  it("reduces a cloud ARN to its model part, so no account identifier is recorded", () => {
    expect(
      usageModelName(
        "arn:aws:bedrock:us-east-1:123456789012:inference-profile/us.anthropic.claude-opus-5-5-v1:0",
      ),
    ).toBe("us.anthropic.claude-opus-5-5-v1:0");
    expect(usageModelName("arn:aws:bedrock:us-east-1:123456789012:foundation-model")).toBeNull();
  });

  it("has no name for anything else", () => {
    expect(usageModelName("weird model")).toBeNull();
    expect(usageModelName("x".repeat(129))).toBeNull();
    expect(usageModelName("+plus")).toBeNull();
    expect(usageModelName(undefined)).toBeNull();
  });

  it("tells a decoder that reports usage from one that does not", () => {
    expect(reportsUsage({ takeUsage: () => [], usageAccounting: () => ({}) })).toBe(true);
    expect(reportsUsage({ takeUsage: () => [] })).toBe(false);
    expect(reportsUsage({})).toBe(false);
  });
});
