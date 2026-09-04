import type {
  OperatingGoalReportV1,
  OperatingObjectiveReportV1,
  WorkGraphV1,
} from "@lervo/application-contract";

function count(graph: WorkGraphV1, status: WorkGraphV1["nodes"][number]["status"]): number {
  return graph.nodes.filter((node) => node.status === status).length;
}

export function projectOperatingGoalReport(input: {
  objective: OperatingObjectiveReportV1;
  graph: WorkGraphV1;
}): OperatingGoalReportV1 {
  if (
    input.objective.projectId !== input.graph.projectId ||
    input.objective.workstreamId !== input.graph.workstreamId
  ) {
    throw new TypeError("The operating goal sources do not share one authority coordinate.");
  }
  const progress = {
    total: input.graph.nodes.length,
    queued: count(input.graph, "queued"),
    active: count(input.graph, "leased"),
    blocked: count(input.graph, "blocked"),
    failed: count(input.graph, "failed"),
    completed: count(input.graph, "completed"),
    cancelled: count(input.graph, "cancelled"),
  };
  const pendingAuthority = [
    ...input.objective.pendingDecisions.filter((item) => item.blocking),
    ...input.objective.pendingApprovals.filter((item) => item.blocking),
  ].length;
  const unresolvedAssignments =
    progress.queued + progress.active + progress.blocked + progress.failed;
  const reasonCodes = [
    ...input.graph.validity.reasonCodes.map((reason) => `graph_${reason}`),
    ...(input.objective.status === "completed" && unresolvedAssignments > 0
      ? ["completed_workstream_has_unresolved_assignments"]
      : []),
    ...(input.objective.status === "completed" && pendingAuthority > 0
      ? ["completed_workstream_has_pending_authority"]
      : []),
  ];
  const completionStatus: OperatingGoalReportV1["completion"]["status"] =
    input.graph.validity.status === "invalid" || reasonCodes.length > 0
      ? "inconsistent"
      : input.objective.status === "completed"
        ? "completed"
        : input.objective.status === "blocked" ||
            input.objective.blockers.length > 0 ||
            pendingAuthority > 0 ||
            progress.blocked > 0 ||
            progress.failed > 0
          ? "blocked"
          : unresolvedAssignments === 0 && input.objective.nextActions.length === 0
            ? "ready_for_completion"
            : "active";
  return {
    schemaVersion: 1,
    kind: "operating_goal.report",
    projectId: input.objective.projectId,
    observedAt: input.objective.observedAt,
    goal: {
      goalId: input.objective.workstreamId,
      authoritySource: "workstream",
      revision: input.objective.workstreamRevision,
      status: input.objective.status,
      title: input.objective.title,
      objective: input.objective.objective,
      updatedAt: input.objective.updatedAt,
    },
    hierarchy: {
      kind: "workstream_assignment_dag",
      graph: structuredClone(input.graph),
    },
    progress,
    completion: { status: completionStatus, reasonCodes },
    authority: {
      createsGoal: false,
      changesWorkstream: false,
      changesAssignments: false,
      startsProvider: false,
    },
    limitations: [
      "The workstream remains root-goal authority and assignments remain execution authority.",
      "This projection does not create a separate goal hierarchy, schedule work, or infer completion.",
    ],
  };
}
