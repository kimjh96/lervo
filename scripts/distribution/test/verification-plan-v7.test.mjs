import { expect, it } from "vitest";

import { createChangedRuntimeVerificationPlanV7 } from "../changed-verification/verification-plan-v7.mjs";

it("keeps the full test set in four fork-backed shards", () => {
  const plans = [1, 2, 3, 4].map((index) =>
    createChangedRuntimeVerificationPlanV7(["scripts/distribution/change.mjs"], index),
  );
  expect(plans.map((plan) => plan.mode)).toEqual(["full", "full", "full", "full"]);
  expect(plans.map((plan) => plan.arguments.at(-1))).toEqual([
    "--shard=1/4",
    "--shard=2/4",
    "--shard=3/4",
    "--shard=4/4",
  ]);
  for (const plan of plans) {
    expect(plan.arguments).toContain("--pool=forks");
    expect(plan.arguments).toContain("--maxWorkers=4");
    expect(plan.arguments).not.toContain("--pool=threads");
  }
});

it("keeps related selection and rejects invalid shard positions", () => {
  const plan = createChangedRuntimeVerificationPlanV7(["packages/core/src/example.ts"], 2);
  expect(plan.mode).toBe("related");
  expect(plan.arguments.slice(0, 3)).toEqual(["run", "--changed", "HEAD"]);
  expect(plan.arguments).toContain("--pool=forks");
  expect(plan.arguments.at(-1)).toBe("--shard=2/4");
  for (const index of [0, 5, 1.5, NaN]) {
    expect(() => createChangedRuntimeVerificationPlanV7([], index)).toThrow();
  }
});
