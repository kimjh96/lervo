import { describe, expect, it } from "vitest";

import { waitForTurn } from "../../natural-language-evaluation/delegated-retrieval-runner.mjs";

describe("delegated retrieval provider errors", () => {
  it("counts bounded failure codes without retaining diagnostics", async () => {
    const providerTurnId = "turn-1";
    const adapter = {
      async *events() {
        yield {
          type: "provider.error",
          payload: { failureCode: "rate_limited", diagnosticDigest: "sha256:private" },
        };
        yield { type: "provider.error", payload: { failureCode: "rate_limited" } };
        yield { type: "provider.error", payload: { failureCode: "overloaded" } };
        yield {
          type: "provider.turn.completed",
          payload: { providerTurnId, status: "completed" },
        };
      },
    };

    const result = await waitForTurn(adapter, {}, { providerTurnId });
    expect(result.errors).toBe(3);
    expect(Object.fromEntries(result.errorCounts)).toEqual({
      overloaded: 1,
      rate_limited: 2,
    });
    expect(JSON.stringify(Object.fromEntries(result.errorCounts))).not.toContain("private");
  });

  it("preserves the bounded provider turn failure code", async () => {
    const providerTurnId = "turn-2";
    const adapter = {
      async *events() {
        yield {
          type: "provider.turn.failed",
          payload: { providerTurnId, failureCode: "claude_authentication_failed" },
        };
      },
    };

    await expect(waitForTurn(adapter, {}, { providerTurnId })).rejects.toMatchObject({
      failureCode: "claude_authentication_failed",
    });
  });
});
