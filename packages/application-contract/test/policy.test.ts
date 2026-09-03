import { describe, expect, it } from "vitest";

import { normalizeGovernedLoopPolicy } from "../src/index.js";

describe("governed loop policy", () => {
  it("creates bounded fail-closed defaults", () => {
    expect(normalizeGovernedLoopPolicy()).toEqual({
      schemaVersion: 1,
      maxAttemptsPerAssignment: 2,
      maxParallelAssignments: 2,
      tokenLimits: [],
      unobservedResourceAction: "escalate",
      exhaustedResourceAction: "block",
      terminalFailureAction: "escalate",
    });
  });

  it("rejects duplicate accounting coordinates", () => {
    const limit = {
      provider: "codex" as const,
      accountingDescriptorHash: `sha256:${"a".repeat(64)}`,
      stopAfterObservedTotalTokens: 100,
    };
    expect(() => normalizeGovernedLoopPolicy({ tokenLimits: [limit, limit] })).toThrow(
      "coordinates are invalid",
    );
  });

  it("keeps otherwise identical limits distinct by resource scope", () => {
    const accountingDescriptorHash = `sha256:${"a".repeat(64)}`;
    expect(
      normalizeGovernedLoopPolicy({
        tokenLimits: [
          {
            provider: "codex",
            scope: "primary_provider",
            accountingDescriptorHash,
            stopAfterObservedTotalTokens: 100,
          },
          {
            provider: "codex",
            scope: "subagent_provider",
            accountingDescriptorHash,
            stopAfterObservedTotalTokens: 50,
          },
        ],
      }).tokenLimits,
    ).toHaveLength(2);
  });
});
