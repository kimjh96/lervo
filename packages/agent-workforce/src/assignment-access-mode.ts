import type { AssignmentAccessMode, WorkforceAssignment } from "./types.js";

export function assignmentAccessMode(assignment: WorkforceAssignment): AssignmentAccessMode {
  return assignment.accessMode ?? "write";
}
