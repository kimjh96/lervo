import { expect, it } from "vitest";

import { ManagedProviderInteractionLimiter } from "../src/provider-interaction-limits.js";

const usage = (providerTurnId: string, totalTokens: number, cachedInputTokens: number) =>
  ({
    type: "provider.usage.updated",
    payload: { providerTurnId, totalTokens, cachedInputTokens },
  }) as unknown as Parameters<ManagedProviderInteractionLimiter["observe"]>[0];

it("charges each turn's cached re-reads at their cost against the run token limit", () => {
  const limiter = new ManagedProviderInteractionLimiter({ maximumTotalTokens: 600_000 });
  // Three turns re-reading a ~200k cached context stay far inside a 600k budget.
  for (const turn of ["t1", "t2", "t3"]) limiter.observe(usage(turn, 210_000, 190_000));
  expect(() => limiter.observe(usage("t4", 700_000, 0))).toThrow(
    expect.objectContaining({ code: "provider_token_limit_exceeded" }),
  );
});
