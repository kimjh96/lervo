import type {
  ManagedAttemptObservationV1,
  WorkGraphNodeV2,
  WorkGraphV2,
} from "@lervo/application-contract";
import type { EventEnvelope } from "@lervo/schemas";

import { projectWorkGraph, type AssignmentGraphSourceV1 } from "./graph-projection.js";
import { sha256 } from "./hash.js";
import {
  assignmentTopologyHistoryEventTypes,
  projectAssignmentTopologyHistory,
} from "./topology-history-projection.js";

/** Event types `projectWorkGraphV2` consumes; a typed read of them is sufficient input. */
export const workGraphV2EventTypes: readonly string[] = [...assignmentTopologyHistoryEventTypes];

export function projectWorkGraphV2(input: {
  projectId: string;
  workstreamId: string;
  assignments: readonly AssignmentGraphSourceV1[];
  attempts: readonly ManagedAttemptObservationV1[];
  events: readonly EventEnvelope[];
  observedAt: string;
}): WorkGraphV2 {
  const base = projectWorkGraph(input);
  const sources = new Map(
    input.assignments.map((assignment) => [assignment.assignmentId, assignment]),
  );
  const nodes = base.nodes.map<WorkGraphNodeV2>((node) => ({
    ...node,
    topology: sources.get(node.assignmentId)?.topology ?? null,
  }));
  const dependentCounts = new Map<string, number>();
  for (const node of nodes) {
    for (const dependencyId of node.dependencyIds) {
      dependentCounts.set(dependencyId, (dependentCounts.get(dependencyId) ?? 0) + 1);
    }
  }
  const topologyHistory = projectAssignmentTopologyHistory({
    events: input.events,
    workstreamId: input.workstreamId,
  });
  const validityReasons = new Set(base.validity.reasonCodes);
  if (topologyHistory.status === "invalid") validityReasons.add("topology_history_invalid");
  const graphState = {
    schemaVersion: 2 as const,
    contractVersion: 2 as const,
    graphId: base.graphId,
    projectId: base.projectId,
    workstreamId: base.workstreamId,
    validity: {
      status: validityReasons.size === 0 ? ("valid" as const) : ("invalid" as const),
      reasonCodes: [...validityReasons].sort(),
    },
    nodes,
    rootAssignmentIds: base.rootAssignmentIds,
    branchAssignmentIds: [...dependentCounts]
      .filter(([, count]) => count > 1)
      .map(([assignmentId]) => assignmentId)
      .sort(),
    joinAssignmentIds: base.joinAssignmentIds,
    topologyHistory,
  };
  return {
    ...graphState,
    observedAt: input.observedAt,
    graphHash: sha256(JSON.stringify(graphState)),
  };
}
