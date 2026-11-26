/**
 * An ADE conversation's assignment (Lervo ADE coordination): it starts with no paths and its live
 * lease grows by claims, so it alone may be created empty and hold more than 128 paths.
 */
export const CONVERSATION_TASK_TYPE = "repository.conversation";

/** The bound of every other assignment's expected paths. */
export const MAXIMUM_ASSIGNMENT_EXPECTED_PATHS = 128;

/** A conversation's bound: a sealed result's changed paths, at most 10,000. */
export const MAXIMUM_CONVERSATION_EXPECTED_PATHS = 10_000;

export function isConversationTaskType(taskType: string): boolean {
  return taskType === CONVERSATION_TASK_TYPE;
}

export function maximumExpectedPaths(taskType: string): number {
  return isConversationTaskType(taskType)
    ? MAXIMUM_CONVERSATION_EXPECTED_PATHS
    : MAXIMUM_ASSIGNMENT_EXPECTED_PATHS;
}
