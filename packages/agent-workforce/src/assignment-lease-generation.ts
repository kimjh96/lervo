import type { WorkforceAssignment } from "./types.js";

export function nextAssignmentLeaseGeneration(
  assignment: Pick<WorkforceAssignment, "lease" | "lastLeaseGeneration">,
): number {
  return Math.max(assignment.lease?.generation ?? 0, assignment.lastLeaseGeneration ?? 0) + 1;
}
