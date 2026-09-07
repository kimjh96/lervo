import { describe, expect, it } from "vitest";

import type {
  GovernedWorkReportV1,
  UnattendedSchedulerAgentV1,
  UnattendedSchedulerAssignmentV1,
} from "@lervo/application-contract";

import { selectUnattendedSchedulerAction } from "../src/unattended-scheduler-selection.js";

const assignmentId = "asn_111111111111111111111111";
const agentId = "agt_111111111111111111111111";
const workstreamId = "wks_111111111111111111111111";

function assignment(): UnattendedSchedulerAssignmentV1 {
  return {
    assignmentId,
    revision: 1,
    workstreamId,
    taskType: "implementation",
    roleId: "developer",
    roleVersion: "1.0.0",
    roleContractHash: `sha256:${"a".repeat(64)}`,
    requiredCapabilityHash: null,
    acceptanceCriteria: ["Implement the bounded change."],
    verificationSuiteIds: ["project.quick"],
    expectedPaths: ["src"],
    assigneeAgentId: null,
    lease: null,
  };
}

function agent(): UnattendedSchedulerAgentV1 {
  return {
    agentId,
    roleId: "developer",
    roleVersion: "1.0.0",
    roleContractHash: `sha256:${"a".repeat(64)}`,
    provider: "any",
    capabilityHash: `sha256:${"b".repeat(64)}`,
    skillIds: [],
    capabilityIds: [],
    responsibilityPaths: ["src"],
    status: "active",
  };
}

function report(action: GovernedWorkReportV1["decision"]["actions"][number]): GovernedWorkReportV1 {
  const graph: GovernedWorkReportV1["graph"] = {
    schemaVersion: 1,
    graphId: "wgr_111111111111111111111111",
    graphHash: `sha256:${"c".repeat(64)}`,
    projectId: "prj_fixture001",
    workstreamId,
    observedAt: "2026-09-07T00:00:00.000Z",
    validity: { status: "valid", reasonCodes: [] },
    nodes: [
      {
        assignmentId,
        assignmentRevision: 1,
        taskType: "implementation",
        roleId: "developer",
        status: action.kind === "start_attempt" ? "leased" : "queued",
        priority: 50,
        dependencyIds: [],
        approvalRequirementDigests: [],
        leaseState: action.kind === "start_attempt" ? "active" : "none",
        assigneeAgentId: action.kind === "start_attempt" ? agentId : null,
        leaseId: action.kind === "start_attempt" ? "lse_111111111111111111111111" : null,
        attemptCount: 0,
      },
    ],
    rootAssignmentIds: [assignmentId],
    joinAssignmentIds: [],
  };
  return {
    schemaVersion: 1,
    projectId: graph.projectId,
    workstreamId,
    graph,
    attempts: [],
    completionEvidence: [],
    resources: [],
    stages: [],
    budgets: [],
    approvals: [],
    policy: {
      schemaVersion: 1,
      maxAttemptsPerAssignment: 2,
      maxParallelAssignments: 1,
      tokenLimits: [],
      tokenMetricLimits: [],
      durationLimits: [],
      unobservedResourceAction: "escalate",
      exhaustedResourceAction: "block",
      terminalFailureAction: "escalate",
    },
    decision: {
      schemaVersion: 1,
      decisionId: "gld_111111111111111111111111",
      graphHash: graph.graphHash,
      status: action.kind === "complete_work" ? "complete" : "ready",
      actions: [action],
    },
  };
}

function select(governed: GovernedWorkReportV1, assignments = [assignment()], agents = [agent()]) {
  return selectUnattendedSchedulerAction({
    schemaVersion: 1,
    schedulerSessionId: "ses_scheduler_11111111",
    provider: "codex",
    eligibleAgentIds: [],
    report: governed,
    assignments,
    agents,
  });
}

describe("unattended scheduler selection", () => {
  it("selects the exact compatible agent for a governed claim", () => {
    const selected = select(
      report({ kind: "claim_assignment", assignmentId, reasonCode: "ready" }),
    );

    expect(selected).toMatchObject({
      kind: "claim_assignment",
      assignmentId,
      expectedAssignmentRevision: 1,
      agentId,
    });
    expect(selected.decisionId).toMatch(/^usd_[a-f0-9]{17}$/u);
  });

  it("executes only a lease owned by the current scheduler session", () => {
    const governed = report({
      kind: "start_attempt",
      assignmentId,
      reasonCode: "ready",
      causality: { relationship: "root", workstreamId, assignmentId, agentId },
    });
    const leased = {
      ...assignment(),
      assigneeAgentId: agentId,
      lease: {
        leaseId: "lse_111111111111111111111111",
        sessionId: "ses_scheduler_11111111",
      },
    };

    expect(select(governed, [leased])).toMatchObject({
      kind: "execute_assignment",
      attemptKind: "start_attempt",
      assignmentId,
      agentId,
    });
    expect(
      select(governed, [
        { ...leased, lease: { ...leased.lease!, sessionId: "ses_foreign_11111111" } },
      ]),
    ).toMatchObject({ kind: "wait", reasonCode: "foreign_active_lease" });
  });

  it("fails closed for incompatible agents and prepared completion", () => {
    const claim = report({ kind: "claim_assignment", assignmentId, reasonCode: "ready" });
    expect(
      select(claim, [assignment()], [{ ...agent(), responsibilityPaths: ["docs"] }]),
    ).toMatchObject({ kind: "stop", reasonCode: "no_eligible_agent" });

    const reconciliation = report({
      kind: "reconcile_completion",
      assignmentId,
      reasonCode: "completion_evidence_verified",
      completionEvidenceId: "acp_111111111111111111111111",
      runId: "run_111111111111111111111111",
    });
    expect(select(reconciliation)).toMatchObject({
      kind: "stop",
      reasonCode: "completion_reconciliation_required",
      assignmentId,
    });
  });

  it("does not mutate cancellation or claim stale assignment revisions", () => {
    const cancellation = report({
      kind: "cancel_assignment",
      assignmentId,
      reasonCode: "dependency_cancelled",
    });
    expect(select(cancellation)).toMatchObject({
      kind: "stop",
      reasonCode: "cancellation_required",
    });

    const claim = report({ kind: "claim_assignment", assignmentId, reasonCode: "ready" });
    expect(select(claim, [{ ...assignment(), revision: 2 }])).toMatchObject({
      kind: "stop",
      reasonCode: "governed_invalid",
      governedReasonCode: "assignment_snapshot_mismatch",
    });
  });

  it("waits within scheduler bounds for approval without granting it", () => {
    const governed = report({
      kind: "await_approval",
      assignmentId,
      reasonCode: "approval_missing",
      requirementDigests: [`sha256:${"f".repeat(64)}`],
    });
    governed.decision.status = "blocked";

    expect(select(governed)).toMatchObject({
      kind: "wait",
      reasonCode: "approval_pending",
      assignmentId,
    });
  });
});
