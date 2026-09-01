import { workforceLimits } from "./limits.js";
import type { WorkforceAssignment } from "./types.js";

export interface AssignmentCancellationStep {
  assignmentId: string;
  reason: "requested" | "dependency_cancelled";
}

export function planAssignmentCancellation(input: {
  assignments: readonly Pick<WorkforceAssignment, "assignmentId" | "dependencyIds" | "status">[];
  requestedAssignmentIds: readonly string[];
}): AssignmentCancellationStep[] {
  if (
    input.assignments.length > workforceLimits.maximumAssignments ||
    input.requestedAssignmentIds.length === 0 ||
    input.requestedAssignmentIds.length > workforceLimits.maximumAssignmentDependencies
  ) {
    throw new TypeError("Assignment cancellation coordinates exceed their bounds.");
  }
  const byId = new Map(
    input.assignments.map((assignment) => [assignment.assignmentId, assignment]),
  );
  if (byId.size !== input.assignments.length) {
    throw new TypeError("Assignment cancellation input contains duplicate assignments.");
  }
  const requested = new Set(input.requestedAssignmentIds);
  if ([...requested].some((assignmentId) => !byId.has(assignmentId))) {
    throw new TypeError("Assignment cancellation input names an unknown assignment.");
  }
  const selected = new Set(requested);
  let changed = true;
  while (changed) {
    changed = false;
    for (const assignment of input.assignments) {
      if (
        !selected.has(assignment.assignmentId) &&
        assignment.dependencyIds.some((dependencyId) => selected.has(dependencyId))
      ) {
        selected.add(assignment.assignmentId);
        changed = true;
      }
    }
  }
  const terminal = new Set(["completed", "failed", "cancelled"]);
  return [...selected]
    .map((assignmentId) => byId.get(assignmentId)!)
    .filter((assignment) => !terminal.has(assignment.status))
    .sort((left, right) => left.assignmentId.localeCompare(right.assignmentId))
    .map((assignment) => ({
      assignmentId: assignment.assignmentId,
      reason: requested.has(assignment.assignmentId) ? "requested" : "dependency_cancelled",
    }));
}
