import { describe, expect, it } from "vitest";

import {
  evaluateWorkspaceCleanup,
  orderWorkspaceIntegrations,
  partitionWorkspaceChanges,
  transitionWorkspace,
  type AgentWorkspace,
  type WorkspaceCleanupObservation,
} from "../src/index.js";

const hash = `sha256:${"a".repeat(64)}`;
const commit = "b".repeat(40);

function workspace(state: AgentWorkspace["state"] = "provisioning"): AgentWorkspace {
  return {
    schemaVersion: 1,
    workspaceId: "wsp_0123456789abcdef01234567",
    generation: 1,
    repositoryInstanceId: "rpi_0123456789abcdef01234567",
    projectId: "prj_workspace_test",
    assignmentId: "asn_0123456789abcdef01234567",
    agentId: "agt_0123456789abcdef01234567",
    leaseGeneration: 1,
    executionKind: "worker",
    host: { kind: "git", version: "1.0.0", nativeInstanceDigest: null },
    baseCommit: commit,
    integrationTargetDigest: hash,
    creationPlanId: "wpl_0123456789abcdef01234567",
    markerHash: hash,
    pathDigest: hash,
    state,
    writerSession: null,
    sealedResult: null,
    integrationEvidenceId: null,
    cleanupPlanId: null,
    recoveryReason: null,
    revision: 1,
    createdAt: "2026-08-26T00:00:00Z",
    updatedAt: "2026-08-26T00:00:00Z",
  };
}

describe("agent workspace lifecycle", () => {
  it("requires exact generation, revision, and host evidence before ready", () => {
    expect(() =>
      transitionWorkspace({
        current: workspace(),
        expectedRevision: 1,
        expectedGeneration: 1,
        nextState: "ready",
        occurredAt: "2026-08-26T00:01:00Z",
      }),
    ).toThrowError(expect.objectContaining({ code: "workspace_transition_conflict" }));
    expect(
      transitionWorkspace({
        current: workspace(),
        expectedRevision: 1,
        expectedGeneration: 1,
        nextState: "ready",
        occurredAt: "2026-08-26T00:01:00Z",
        evidence: { hostInspected: true, markerMatched: true, checkoutClean: true },
      }),
    ).toMatchObject({ state: "ready", revision: 2 });
  });

  it("does not infer cleanup from integration alone", () => {
    const passing: WorkspaceCleanupObservation = {
      owned: true,
      stateIntegrated: true,
      sealedBytesMatch: true,
      checkoutClean: true,
      headReachable: true,
      leaseAbsent: true,
      writerAbsent: true,
      terminalAbsent: true,
      childWorkspaceAbsent: true,
      gitOperationAbsent: true,
      reviewLinkAbsent: true,
      transactionAbsent: true,
      approvalAbsent: true,
      recoveryMarkerAbsent: true,
      markerMatched: true,
      repositoryMatched: true,
      adapterMatched: true,
      pathMatched: true,
      quiescenceProven: true,
      nonForceRemovalSupported: true,
    };
    expect(evaluateWorkspaceCleanup(passing)).toEqual({ eligible: true, reasons: [] });
    expect(
      evaluateWorkspaceCleanup({ ...passing, terminalAbsent: false, checkoutClean: false }),
    ).toEqual({
      eligible: false,
      reasons: ["checkout_dirty", "terminal_live_or_uncertain"],
    });
  });

  it("partitions worker changes without attributing runtime or foreign paths", () => {
    expect(
      partitionWorkspaceChanges({
        expectedPaths: ["packages/worker"],
        changedPaths: [
          "docs/global.md",
          ".lervo/state/workstreams/current.json",
          "packages/worker/src/a.ts",
        ],
        runtimeExcludedPaths: [".lervo/state"],
      }),
    ).toEqual({
      expected: ["packages/worker/src/a.ts"],
      outsideScope: ["docs/global.md"],
      runtimeExcluded: [".lervo/state/workstreams/current.json"],
    });
  });

  it("orders dependency-ready integrations deterministically", () => {
    const ordered = orderWorkspaceIntegrations([
      {
        workspaceId: "wsp_222222222222222222222222",
        generation: 1,
        assignmentId: "asn_222222222222222222222222",
        dependencyAssignmentIds: ["asn_111111111111111111111111"],
        priority: 100,
        sealedAt: "2026-08-26T00:00:00Z",
      },
      {
        workspaceId: "wsp_111111111111111111111111",
        generation: 1,
        assignmentId: "asn_111111111111111111111111",
        dependencyAssignmentIds: [],
        priority: 10,
        sealedAt: "2026-08-26T00:01:00Z",
      },
    ]);
    expect(ordered.map((item) => item.assignmentId)).toEqual([
      "asn_111111111111111111111111",
      "asn_222222222222222222222222",
    ]);
  });
});
