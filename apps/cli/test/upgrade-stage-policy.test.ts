import { describe, expect, it } from "vitest";

import {
  applicableUpgradeStages,
  deferralReason,
  deferringPrerequisite,
  overallUpgradeStatus,
  upgradeStageDependencies,
} from "../src/upgrade-stage-policy.js";

describe("upgrade stage dependency policy", () => {
  it("declares terminal integration and capabilities independent of knowledge", () => {
    expect(upgradeStageDependencies.terminal_integration).toEqual([]);
    expect(upgradeStageDependencies.capabilities).toEqual([]);
    expect(upgradeStageDependencies.node).toEqual([
      { stage: "knowledge", requires: "not_blocked" },
    ]);
  });

  it("defers dependents of an unapplied or blocked prerequisite only", () => {
    expect(deferringPrerequisite("workforce", { capabilities: "safe_apply" })).toEqual({
      stage: "capabilities",
      requires: "applied_first",
    });
    expect(deferringPrerequisite("workforce", { capabilities: "current" })).toBeNull();
    const nodeDeferral = deferringPrerequisite("node", { knowledge: "blocked" });
    expect(nodeDeferral).not.toBeNull();
    expect(deferralReason(nodeDeferral!)).toBe("knowledge_stage_blocked");
    expect(deferringPrerequisite("node", { knowledge: "pending_authority" })).toBeNull();
    expect(deferringPrerequisite("terminal_integration", { knowledge: "blocked" })).toBeNull();
  });

  it("keeps a blocked plan non-current while listing independent safe stages", () => {
    const dispositions = {
      capabilities: "current",
      workforce: "current",
      terminal_integration: "safe_apply",
      knowledge: "blocked",
      node: "deferred",
    } as const;
    expect(overallUpgradeStatus(Object.values(dispositions))).toBe("blocked");
    expect(applicableUpgradeStages(dispositions, false)).toEqual(["terminal_integration"]);
    expect(
      applicableUpgradeStages({ ...dispositions, workforce: "pending_authority" }, true),
    ).toEqual(["workforce", "terminal_integration"]);
  });
});
