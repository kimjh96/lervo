import { describe, expect, it } from "vitest";

import type {
  AssignmentCommunicationReportV1,
  GovernedWorkReportV1,
  OperatingObjectiveReportV1,
} from "@lervo/application-contract";

import {
  projectOperatingBoard,
  renderGovernedWorkBoard,
  renderOperatingBoardHtml,
} from "../src/index.js";

const firstAssignmentId = "asn_111111111111111111111111";
const secondAssignmentId = "asn_222222222222222222222222";

function report(): GovernedWorkReportV1 {
  const workstreamId = "wks_111111111111111111111111";
  const graphHash = `sha256:${"a".repeat(64)}`;
  return {
    schemaVersion: 1,
    projectId: "prj_fixture001",
    workstreamId,
    graph: {
      schemaVersion: 1,
      graphId: "wgr_111111111111111111111111",
      graphHash,
      projectId: "prj_fixture001",
      workstreamId,
      observedAt: "2026-09-02T00:00:00.000Z",
      validity: { status: "valid", reasonCodes: [] },
      nodes: [
        {
          assignmentId: firstAssignmentId,
          assignmentRevision: 1,
          taskType: '<script>alert("unsafe")</script>',
          roleId: "researcher",
          status: "completed",
          priority: 60,
          dependencyIds: [],
          approvalRequirementDigests: [],
          leaseState: "none",
          assigneeAgentId: "agt_111111111111111111111111",
          leaseId: null,
          attemptCount: 1,
        },
        {
          assignmentId: secondAssignmentId,
          assignmentRevision: 3,
          taskType: "implementation",
          roleId: "developer",
          status: "leased",
          priority: 50,
          dependencyIds: [firstAssignmentId],
          approvalRequirementDigests: [`sha256:${"b".repeat(64)}`],
          leaseState: "active",
          assigneeAgentId: "agt_222222222222222222222222",
          leaseId: "lse_222222222222222222222222",
          attemptCount: 1,
        },
      ],
      rootAssignmentIds: [firstAssignmentId],
      joinAssignmentIds: [secondAssignmentId],
    },
    attempts: [
      {
        schemaVersion: 1,
        assignmentId: secondAssignmentId,
        workId: "wrk_222222222222222222222222",
        runId: "run_222222222222222222222222",
        relationship: "root",
        attemptOrdinal: 1,
        terminalStatus: "completed",
        verificationStatus: "passed",
      },
    ],
    completionEvidence: [
      {
        schemaVersion: 1,
        completionEvidenceId: "acp_222222222222222222222222",
        workstreamId,
        assignmentId: secondAssignmentId,
        assignmentRevision: 3,
        agentId: "agt_222222222222222222222222",
        leaseId: "lse_222222222222222222222222",
        runId: "run_222222222222222222222222",
        sessionId: "ses_222222222222222222222222",
        resultArtifactId: "art_222222222222222222222222",
        resultContentHash: `sha256:${"c".repeat(64)}`,
        preparedAt: "2026-09-02T00:01:00.000Z",
      },
    ],
    resources: [
      {
        schemaVersion: 1,
        provider: "codex",
        scope: "primary_provider",
        source: "provider_reported",
        accountingMode: "turn_cumulative",
        accountingDescriptorHash: `sha256:${"d".repeat(64)}`,
        completeness: "complete",
        totalTokens: 1234,
        runCount: 1,
        reasonCodes: [],
      },
    ],
    approvals: [
      {
        schemaVersion: 1,
        assignmentId: secondAssignmentId,
        assignmentRevision: 3,
        requirementDigest: `sha256:${"b".repeat(64)}`,
        status: "missing",
        reasonCode: "authority_unavailable",
      },
    ],
    policy: {
      schemaVersion: 1,
      maxAttemptsPerAssignment: 2,
      maxParallelAssignments: 2,
      tokenLimits: [
        {
          provider: "codex",
          scope: "primary_provider",
          accountingDescriptorHash: `sha256:${"d".repeat(64)}`,
          stopAfterObservedTotalTokens: 1500,
        },
        {
          provider: "claude",
          accountingDescriptorHash: `sha256:${"e".repeat(64)}`,
          stopAfterObservedTotalTokens: 2000,
        },
      ],
      unobservedResourceAction: "escalate",
      exhaustedResourceAction: "block",
      terminalFailureAction: "escalate",
    },
    decision: {
      schemaVersion: 1,
      decisionId: "gld_111111111111111111111111",
      graphHash,
      status: "ready",
      actions: [
        {
          kind: "reconcile_completion",
          assignmentId: secondAssignmentId,
          reasonCode: "completion_evidence_verified",
          completionEvidenceId: "acp_222222222222222222222222",
          runId: "run_222222222222222222222222",
        },
      ],
    },
  };
}

function objective(): OperatingObjectiveReportV1 {
  return {
    schemaVersion: 1,
    projectId: "prj_fixture001",
    workstreamId: "wks_111111111111111111111111",
    workstreamRevision: 4,
    status: "active",
    title: "Protect <current> objective",
    objective: "Expose verified operating evidence.",
    nextActions: ["Review the exact board."],
    blockers: [],
    pendingDecisions: [],
    pendingApprovals: [],
    updatedAt: "2026-09-02T00:00:00.000Z",
    observedAt: "2026-09-02T00:02:00.000Z",
  };
}

function communications(): AssignmentCommunicationReportV1 {
  const route = {
    schemaVersion: 1 as const,
    threadId: "ath_111111111111111111111111",
    handoffId: "hnd_111111111111111111111111",
    assignmentId: secondAssignmentId,
    fromAgentId: "agt_222222222222222222222222",
    toAgentId: "agt_111111111111111111111111",
    requestDigest: `sha256:${"f".repeat(64)}`,
    artifactReferences: [
      { artifactId: "art_interaction01", contentHash: `sha256:${"1".repeat(64)}` },
    ],
    contextEvidenceEventIds: [],
    routedAt: "2026-09-02T00:01:00.000Z",
    routeState: "recorded" as const,
    deliveryState: "unobserved" as const,
    acknowledgementState: "unobserved" as const,
  };
  return {
    schemaVersion: 1,
    projectId: "prj_fixture001",
    workstreamId: "wks_111111111111111111111111",
    observedAt: "2026-09-02T00:02:00.000Z",
    validity: { status: "valid", reasonCodes: [] },
    threads: [
      {
        schemaVersion: 1,
        threadId: route.threadId,
        assignmentId: secondAssignmentId,
        assignmentRevision: 3,
        assignmentStatus: "leased",
        routes: [route],
      },
    ],
    inbox: [
      {
        schemaVersion: 1,
        inboxItemId: "ain_111111111111111111111111",
        threadId: route.threadId,
        handoffId: route.handoffId,
        assignmentId: secondAssignmentId,
        fromAgentId: route.fromAgentId,
        recipientAgentId: route.toAgentId,
        recipientAgentStatus: "active",
        artifactCount: 1,
        routedAt: route.routedAt,
        routeState: "recorded",
        deliveryState: "unobserved",
        acknowledgementState: "unobserved",
      },
    ],
    limitations: [],
  };
}

describe("local operating board", () => {
  it("projects governed evidence without inventing authority or hidden work", () => {
    const view = projectOperatingBoard(report(), objective());

    expect(view.summary).toMatchObject({
      assignmentCount: 2,
      attemptCount: 1,
      preparedCompletionCount: 1,
      attentionApprovalCount: 1,
      resourceGroupCount: 1,
    });
    expect(view.nodes[1]).toMatchObject({
      assignmentId: secondAssignmentId,
      dependencyIds: [firstAssignmentId],
      isJoin: true,
      leaseState: "active",
    });
    expect(view.nodes[1]!.attempts).toHaveLength(1);
    expect(view.nodes[1]!.completionEvidence).toHaveLength(1);
    expect(view.objective?.workstreamRevision).toBe(4);
    expect(view.budgets).toEqual([
      expect.objectContaining({
        provider: "codex",
        scope: "primary_provider",
        observedTokens: 1234,
        remainingObservedTokens: 266,
        thresholdState: "below",
      }),
      expect.objectContaining({
        provider: "claude",
        observedTokens: null,
        remainingObservedTokens: null,
        completeness: "unobserved",
        thresholdState: "unknown",
      }),
    ]);
    expect(view.limitations.join(" ")).toContain("read-only projection");
    expect(view.limitations.join(" ")).toContain("Selected, loaded, injected, and used");
  });

  it("keeps a legacy unscoped budget unknown when multiple resource scopes match", () => {
    const value = report();
    delete value.policy.tokenLimits[0]!.scope;
    value.resources.push({
      ...value.resources[0]!,
      scope: "subagent_provider",
      totalTokens: 50,
    });

    expect(projectOperatingBoard(value).budgets[0]).toMatchObject({
      scope: null,
      observedTokens: null,
      remainingObservedTokens: null,
      completeness: "unobserved",
      thresholdState: "unknown",
    });
  });

  it("renders deterministic, escaped, self-contained HTML with dependency navigation", () => {
    const view = projectOperatingBoard(report(), objective());
    const first = renderOperatingBoardHtml(view);
    const second = renderGovernedWorkBoard(report(), objective());

    expect(first).toBe(second);
    expect(first).toContain("<!doctype html>");
    expect(first).toContain("Content-Security-Policy");
    expect(first).toContain(`href="#assignment-1"`);
    expect(first).toContain("Projection, not authority");
    expect(first).toContain("1234 tokens");
    expect(first).toContain("Protect &lt;current&gt; objective");
    expect(first).toContain("1234 / 1500 tokens");
    expect(first).toContain("&lt;script&gt;alert(&quot;unsafe&quot;)&lt;/script&gt;");
    expect(first).not.toContain('<script>alert("unsafe")</script>');
    expect(first).not.toContain("<button");
    expect(first).not.toContain("<script");
  });

  it("shows recorded interaction and inbox routes without claiming delivery", () => {
    const value = communications();
    const view = projectOperatingBoard(report(), objective(), value);
    const html = renderGovernedWorkBoard(report(), objective(), value);

    expect(view.summary).toMatchObject({ interactionRouteCount: 1, inboxRouteCount: 1 });
    expect(view.nodes[1]!.interactionRoutes).toHaveLength(1);
    expect(html).toContain("Assignment inbox");
    expect(html).toContain("unobserved");
    expect(html).toContain("artifacts");
    expect(html).not.toContain("interaction body");
  });
});
