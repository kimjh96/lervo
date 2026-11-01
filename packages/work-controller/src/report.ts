import {
  type ApprovalObservationV1,
  type GovernedWorkQueryV1,
  type GovernedWorkReportV1,
} from "@lervo/application-contract";
import type { EventEnvelope } from "@lervo/schemas";

import { managedAttemptEventTypes, projectManagedAttempts } from "./attempt-projection.js";
import {
  completionEvidenceEventTypes,
  projectCompletionEvidence,
} from "./completion-evidence-projection.js";
import { decideGovernedLoop } from "./governed-loop-decision.js";
import { assessManagedExecutionBudgets } from "./managed-execution-budget.js";
import { projectWorkGraph } from "./graph-projection.js";
import type { AssignmentGraphSourceV1 } from "./graph-projection.js";

/** Event types `projectGovernedWorkReport` consumes; a typed read of them is sufficient input. */
export const governedWorkReportEventTypes: readonly string[] = [
  ...new Set([...managedAttemptEventTypes, ...completionEvidenceEventTypes]),
];

export function projectGovernedWorkReport(input: {
  query: GovernedWorkQueryV1;
  assignments: readonly AssignmentGraphSourceV1[];
  events: readonly EventEnvelope[];
  approvals?: readonly ApprovalObservationV1[];
}): GovernedWorkReportV1 {
  const projection = projectManagedAttempts({
    events: input.events,
    workstreamId: input.query.workstreamId,
  });
  const graph = projectWorkGraph({
    projectId: input.query.projectId,
    workstreamId: input.query.workstreamId,
    assignments: input.assignments,
    attempts: projection.attempts,
    observedAt: input.query.observedAt,
  });
  const completionEvidence = projectCompletionEvidence({
    events: input.events,
    attempts: projection.attempts,
    workstreamId: input.query.workstreamId,
  });
  const approvals = [...(input.approvals ?? [])];
  const budgets = assessManagedExecutionBudgets({
    resources: projection.resources,
    stages: projection.stages,
    policy: input.query.policy,
  });
  return {
    schemaVersion: 1,
    projectId: input.query.projectId,
    workstreamId: input.query.workstreamId,
    graph,
    attempts: projection.attempts,
    completionEvidence,
    resources: projection.resources,
    stages: projection.stages,
    budgets,
    approvals,
    policy: input.query.policy,
    decision: decideGovernedLoop({
      graph,
      attempts: projection.attempts,
      completionEvidence,
      resources: projection.resources,
      stages: projection.stages,
      budgets,
      policy: input.query.policy,
      approvals,
    }),
  };
}
