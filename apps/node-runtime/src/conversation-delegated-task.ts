import { createHash } from "node:crypto";

export const maximumDelegatedTaskCharacters = 1_024;

export function delegatedTaskId(input: {
  sourceEventId: string;
  sourceParticipantId: string;
  targetParticipantId: string;
}): string {
  const suffix = createHash("sha256")
    .update(`${input.sourceEventId}\0${input.sourceParticipantId}\0${input.targetParticipantId}`)
    .digest("base64url")
    .slice(0, 20);
  return `tsk_${suffix}`;
}

/**
 * Carries the coordinator-authored subtask without injecting a synthetic persona or widening its
 * authority. The coordinator retains the human's complete outcome in its own conversation context.
 */
export function delegatedTaskContent(selectedTask: string): string {
  const task = selectedTask.trim();
  if (task.length === 0 || [...task].length > maximumDelegatedTaskCharacters) {
    throw new Error("The delegated subtask exceeds the bounded peer-delegation task contract.");
  }
  return task;
}
