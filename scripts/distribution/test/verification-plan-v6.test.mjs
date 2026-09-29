import { expect, it } from "vitest";

import { createChangedRuntimeVerificationPlanV6 } from "../changed-verification/verification-plan-v6.mjs";

it("keeps full escalation across four distinct Vitest shards", () => {
  const plans = [1, 2, 3, 4].map((index) =>
    createChangedRuntimeVerificationPlanV6(["scripts/distribution/change.mjs"], index),
  );
  expect(plans.map((plan) => plan.mode)).toEqual(["full", "full", "full", "full"]);
  expect(plans.map((plan) => plan.arguments.at(-1))).toEqual([
    "--shard=1/4",
    "--shard=2/4",
    "--shard=3/4",
    "--shard=4/4",
  ]);
  for (const plan of plans) expect(plan.arguments).toContain("--maxWorkers=4");
});

it("keeps the related Git comparison within a shard", () => {
  const plan = createChangedRuntimeVerificationPlanV6(["packages/core/src/example.ts"], 2);
  expect(plan.mode).toBe("related");
  expect(plan.arguments.slice(0, 3)).toEqual(["run", "--changed", "HEAD"]);
  expect(plan.arguments.at(-1)).toBe("--shard=2/4");
});

it("rejects invalid shard positions", () => {
  for (const index of [0, 5, 1.5, NaN]) {
    expect(() => createChangedRuntimeVerificationPlanV6([], index)).toThrow();
  }
});
