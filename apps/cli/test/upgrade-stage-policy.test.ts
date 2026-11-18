import { describe, expect, it } from "vitest";

import {
  knowledgeLintSkipReason,
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

describe("knowledge lint in an upgrade apply (ADR-0589)", () => {
  it("is skipped only when nothing was applied and knowledge is current", () => {
    const current = { disposition: "current" as const, reason: "knowledge_current" };
    // Mac axli on v0.25.5: knowledge current, host and replica services applied after lint.
    expect(knowledgeLintSkipReason([], current)).toBe("knowledge_current_nothing_applied");
    expect(knowledgeLintSkipReason(["capabilities"], current)).toBeNull();
    expect(knowledgeLintSkipReason(["knowledge_materialization"], current)).toBeNull();
    for (const disposition of ["blocked", "pending_authority", "deferred", "safe_apply"] as const)
      expect(knowledgeLintSkipReason([], { disposition, reason: "x" })).toBeNull();
    expect(knowledgeLintSkipReason([], null)).toBeNull();
  });

  it("still lints a current stage whose debt the background resident owns (ADR-0547)", () => {
    expect(
      knowledgeLintSkipReason([], { disposition: "current", reason: "background_owned" }),
    ).toBeNull();
  });
});
