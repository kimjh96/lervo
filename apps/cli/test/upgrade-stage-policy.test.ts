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
      { stage: "knowledge", requires: "ordered_after" },
    ]);
  });

  it("defers dependents of an unapplied or blocked prerequisite only", () => {
    expect(deferringPrerequisite("workforce", { capabilities: "safe_apply" })).toEqual({
      stage: "capabilities",
      requires: "applied_first",
    });
    expect(deferringPrerequisite("workforce", { capabilities: "current" })).toBeNull();
    // ADR-0546: a blocked knowledge stage no longer strands the Node runtime.
    expect(deferringPrerequisite("node", { knowledge: "blocked" })).toBeNull();
    expect(deferringPrerequisite("node", { knowledge: "safe_apply" })).toBeNull();
    expect(deferringPrerequisite("node", { knowledge: "pending_authority" })).toBeNull();
    expect(deferringPrerequisite("terminal_integration", { knowledge: "blocked" })).toBeNull();
  });

  it("orders event writer activation after the hook runtime and Node stages apply", () => {
    expect(upgradeStageDependencies.host_service).toEqual([]);
    const terminal = deferringPrerequisite("event_writer", {
      terminal_integration: "safe_apply",
      node: "current",
    });
    expect(deferralReason(terminal!)).toBe("terminal_integration_must_apply_first");
    expect(
      deferringPrerequisite("event_writer", {
        terminal_integration: "pending_authority",
        node: "current",
      }),
    ).toBeNull();
    const node = deferringPrerequisite("event_writer", {
      terminal_integration: "current",
      node: "safe_apply",
    });
    expect(deferralReason(node!)).toBe("node_must_apply_first");
    expect(
      deferringPrerequisite("event_writer", {
        terminal_integration: "current",
        node: "pending_authority",
      }),
    ).toBeNull();
  });

  it("keeps a blocked plan non-current while listing independent safe stages", () => {
    const dispositions = {
      capabilities: "current",
      workforce: "current",
      terminal_integration: "safe_apply",
      knowledge: "blocked",
      node: "deferred",
      event_writer: "deferred",
      host_service: "safe_apply",
      replica_service: "deferred",
      runtime_retention: "current",
    } as const;
    expect(overallUpgradeStatus(Object.values(dispositions))).toBe("blocked");
    expect(applicableUpgradeStages(dispositions, false)).toEqual([
      "terminal_integration",
      "host_service",
    ]);
    expect(
      applicableUpgradeStages({ ...dispositions, workforce: "pending_authority" }, true),
    ).toEqual(["workforce", "terminal_integration", "host_service"]);
  });
});
