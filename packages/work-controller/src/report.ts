import {
  type ApprovalObservationV1,
  type GovernedWorkQueryV1,
  type GovernedWorkReportV1,
} from "@lervo/application-contract";
import type { EventEnvelope } from "@lervo/schemas";

import { projectManagedAttempts } from "./attempt-projection.js";
import { decideGovernedLoop } from "./governed-loop-decision.js";
import { projectWorkGraph } from "./graph-projection.js";
import type { AssignmentGraphSourceV1 } from "./graph-projection.js";

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
  return {
    schemaVersion: 1,
    projectId: input.query.projectId,
    workstreamId: input.query.workstreamId,
    graph,
    attempts: projection.attempts,
    resources: projection.resources,
    policy: input.query.policy,
    decision: decideGovernedLoop({
      graph,
      attempts: projection.attempts,
      resources: projection.resources,
      policy: input.query.policy,
      ...(input.approvals === undefined ? {} : { approvals: input.approvals }),
    }),
  };
}
