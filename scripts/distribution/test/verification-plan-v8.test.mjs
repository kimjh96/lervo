import { expect, it } from "vitest";

import { createChangedRuntimeVerificationPlanV8 } from "../changed-verification/verification-plan-v8.mjs";

it("retains fork-backed shard selection with an explicit test deadline", () => {
  const plan = createChangedRuntimeVerificationPlanV8(["scripts/distribution/change.mjs"], 3);
  expect(plan.mode).toBe("full");
  expect(plan.arguments).toContain("--pool=forks");
  expect(plan.arguments).toContain("--maxWorkers=4");
  expect(plan.arguments).toContain("--shard=3/4");
  expect(plan.arguments.at(-1)).toBe("--testTimeout=15000");
  expect(plan.testTimeoutMs).toBe(15_000);
});

it("keeps related-test selection under the same deadline", () => {
  const plan = createChangedRuntimeVerificationPlanV8(["packages/core/src/example.ts"], 1);
  expect(plan.mode).toBe("related");
  expect(plan.arguments.slice(0, 3)).toEqual(["run", "--changed", "HEAD"]);
  expect(plan.arguments).toContain("--shard=1/4");
  expect(plan.arguments).toContain("--testTimeout=15000");
  expect(() => createChangedRuntimeVerificationPlanV8([], 5)).toThrow();
});
