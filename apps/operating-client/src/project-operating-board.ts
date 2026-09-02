import type {
  ApplicationAssignmentStatus,
  AssignmentCommunicationReportV1,
  GovernedWorkReportV1,
  OperatingObjectiveReportV1,
} from "@lervo/application-contract";

import type { OperatingBoardViewV1, OperatingBudgetGroupV1 } from "./types.js";

const assignmentStatuses: ApplicationAssignmentStatus[] = [
  "queued",
  "leased",
  "blocked",
  "completed",
  "failed",
  "cancelled",
];

const evidenceLimitations = [
  "This board is a read-only projection. Repository evidence remains authoritative.",
  "Objective and request prose are not present in the privacy-bounded governed-work report.",
  "Selected, loaded, injected, and used knowledge cannot be inferred from this report.",
  "Direct provider activity absent from managed evidence is not represented as managed work.",
];

export function projectObservedBudgets(report: GovernedWorkReportV1): OperatingBudgetGroupV1[] {
  return report.policy.tokenLimits.map((limit) => {
    const observation = report.resources.find(
      (resource) =>
        resource.provider === limit.provider &&
        resource.accountingDescriptorHash === limit.accountingDescriptorHash,
    );
    const observedTokens =
      observation?.completeness === "complete" ? observation.totalTokens : null;
    const thresholdState =
      observedTokens === null
        ? ("unknown" as const)
        : observedTokens >= limit.stopAfterObservedTotalTokens
          ? ("reached" as const)
          : ("below" as const);
    return {
      provider: limit.provider,
      accountingDescriptorHash: limit.accountingDescriptorHash,
      limitTokens: limit.stopAfterObservedTotalTokens,
      observedTokens,
      remainingObservedTokens:
        observedTokens === null
          ? null
          : Math.max(0, limit.stopAfterObservedTotalTokens - observedTokens),
      completeness: observation?.completeness ?? "unobserved",
      thresholdState,
    };
  });
}

export function projectOperatingBoard(
  report: GovernedWorkReportV1,
  objective: OperatingObjectiveReportV1 | null = null,
  communications: AssignmentCommunicationReportV1 | null = null,
): OperatingBoardViewV1 {
  const assignmentStatusCounts = Object.fromEntries(
    assignmentStatuses.map((status) => [
      status,
      report.graph.nodes.filter((node) => node.status === status).length,
    ]),
  ) as Record<ApplicationAssignmentStatus, number>;

  return {
    schemaVersion: 1,
    source: {
      projectId: report.projectId,
      workstreamId: report.workstreamId,
      graphId: report.graph.graphId,
      graphHash: report.graph.graphHash,
      observedAt: report.graph.observedAt,
      decisionId: report.decision.decisionId,
    },
    state: {
      decisionStatus: report.decision.status,
      graphValidity: report.graph.validity.status,
      graphReasonCodes: [...report.graph.validity.reasonCodes],
    },
    summary: {
      assignmentCount: report.graph.nodes.length,
      assignmentStatusCounts,
      attemptCount: report.attempts.length,
      preparedCompletionCount: report.completionEvidence.length,
      verifiedApprovalCount: report.approvals.filter((approval) => approval.status === "verified")
        .length,
      attentionApprovalCount: report.approvals.filter((approval) => approval.status !== "verified")
        .length,
      resourceGroupCount: report.resources.length,
      interactionRouteCount:
        communications?.threads.reduce((total, thread) => total + thread.routes.length, 0) ?? 0,
      inboxRouteCount: communications?.inbox.length ?? 0,
    },
    objective,
    nodes: report.graph.nodes.map((node) => ({
      assignmentId: node.assignmentId,
      assignmentRevision: node.assignmentRevision,
      taskType: node.taskType,
      roleId: node.roleId,
      status: node.status,
      priority: node.priority,
      dependencyIds: [...node.dependencyIds],
      isRoot: report.graph.rootAssignmentIds.includes(node.assignmentId),
      isJoin: report.graph.joinAssignmentIds.includes(node.assignmentId),
      approvalRequirementDigests: [...node.approvalRequirementDigests],
      leaseState: node.leaseState,
      assigneeAgentId: node.assigneeAgentId,
      leaseId: node.leaseId,
      declaredAttemptCount: node.attemptCount,
      attempts: report.attempts.filter((attempt) => attempt.assignmentId === node.assignmentId),
      approvals: report.approvals.filter((approval) => approval.assignmentId === node.assignmentId),
      completionEvidence: report.completionEvidence.filter(
        (evidence) => evidence.assignmentId === node.assignmentId,
      ),
      actions: report.decision.actions.filter(
        (action) => action.assignmentId === node.assignmentId,
      ),
      interactionRoutes:
        communications?.threads.find((thread) => thread.assignmentId === node.assignmentId)
          ?.routes ?? [],
    })),
    actions: [...report.decision.actions],
    resources: [...report.resources],
    budgets: projectObservedBudgets(report),
    inbox: communications?.inbox ?? [],
    communicationValidity: communications?.validity ?? null,
    limitations: [...evidenceLimitations, ...(communications?.limitations ?? [])],
  };
}
