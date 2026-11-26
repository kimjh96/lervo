import type { AssignmentAccessMode, WorkforceAssignment } from "./types.js";

export function assignmentAccessMode(
  assignment: Pick<WorkforceAssignment, "accessMode">,
): AssignmentAccessMode {
  return assignment.accessMode ?? "write";
}
