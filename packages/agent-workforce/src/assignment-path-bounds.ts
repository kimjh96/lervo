/**
 * An ADE conversation's assignment (Lervo ADE coordination): it starts with no paths and its live
 * lease grows by claims, so it alone may be created empty and hold more than 128 paths.
 */
export const CONVERSATION_TASK_TYPE = "repository.conversation";

/** The bound of every other assignment's expected paths. */
export const MAXIMUM_ASSIGNMENT_EXPECTED_PATHS = 128;

/** A conversation's bound when read: a sealed result's changed paths, at most 10,000. */
export const MAXIMUM_CONVERSATION_EXPECTED_PATHS = 10_000;

/**
 * How many paths this release writes into a conversation's lease. Released readers accept at most
 * 128 expected paths, and readers ship first: a later release raises this to 10,000 once every
 * reader in the fleet reads conversation records of that size. Until then coalescing applies at 128.
 */
export const CONVERSATION_WRITE_PATH_LIMIT = 128;

/** The most paths one widening call judges, so each scheduler lock hold stays short. */
export const MAXIMUM_CLAIM_PATHS_PER_CALL = 2_000;

export function isConversationTaskType(taskType: string): boolean {
  return taskType === CONVERSATION_TASK_TYPE;
}

/** The bound a reader accepts. */
export function maximumExpectedPaths(taskType: string): number {
  return isConversationTaskType(taskType)
    ? MAXIMUM_CONVERSATION_EXPECTED_PATHS
    : MAXIMUM_ASSIGNMENT_EXPECTED_PATHS;
}

/** The bound a writer of this release keeps. */
export function maximumWrittenExpectedPaths(taskType: string): number {
  return isConversationTaskType(taskType)
    ? CONVERSATION_WRITE_PATH_LIMIT
    : MAXIMUM_ASSIGNMENT_EXPECTED_PATHS;
}
