import type { UnattendedSchedulerAssignmentV1 } from "@lervo/application-contract";

export function unattendedAssignmentInstructions(
  assignment: UnattendedSchedulerAssignmentV1,
): string {
  return [
    "Complete the current Lervo workforce assignment through the managed execution contract.",
    `Assignment ID: ${assignment.assignmentId}`,
    `Task type: ${assignment.taskType}`,
    "Acceptance criteria:",
    ...assignment.acceptanceCriteria.map((criterion) => `- ${criterion}`),
    "Work only within the assignment's exact authorized paths and satisfy its verification suites.",
    "Do not create, claim, cancel, hand off, or reprioritize assignments.",
  ].join("\n");
}
