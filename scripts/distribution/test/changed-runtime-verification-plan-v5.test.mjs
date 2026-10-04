import { describe, expect, it } from "vitest";

import { createChangedRuntimeVerificationPlanV5 } from "../changed-verification/verification-plan-v5.mjs";

describe("version-five changed runtime verification plan", () => {
  it("keeps related selection and raises only the worker bound", () => {
    const plan = createChangedRuntimeVerificationPlanV5(["packages/core/src/index.ts"]);
    expect(plan.mode).toBe("related");
    expect(plan.arguments).toEqual([
      "run",
      "--changed",
      "HEAD",
      "--passWithNoTests",
      "--pool=threads",
      "--maxWorkers=4",
      "--reporter=dot",
    ]);
  });

  it("retains full escalation for opaque runtime changes", () => {
    const plan = createChangedRuntimeVerificationPlanV5(["packages/core/package.json"]);
    expect(plan.mode).toBe("full");
    expect(plan.arguments).toEqual(["run", "--pool=threads", "--maxWorkers=4", "--reporter=dot"]);
    expect(plan.escalationTriggers).toEqual([
      { path: "packages/core/package.json", reason: "workspace_or_test_configuration" },
    ]);
  });
});
