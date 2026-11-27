import { assignmentAccessMode } from "./assignment-access-mode.js";
import { isConversationTaskType } from "./assignment-path-bounds.js";
import { PathScopeIndex } from "./path-scope-index.js";
import type { WorkforceAssignment } from "./types.js";

/** A claim inside its own lease answers without the scheduler lock while more than this remains. */
export const CONVERSATION_CLAIM_FAST_PATH_MARGIN_MS = 30_000;

/**
 * Whether a conversation's own live lease already holds every path for `agentId` and `sessionId`
 * with more than 30 seconds left (Lervo ADE coordination, "What the handler reads"). It reads no
 * other assignment and takes no lock: no other claim can take a path a live lease holds, so the
 * write lands while the lease still holds it.
 */
export function conversationLeaseCovers(
  assignment: WorkforceAssignment,
  input: { agentId: string; sessionId: string; paths: readonly string[]; now: Date },
): boolean {
  const lease = assignment.lease;
  if (
    !isConversationTaskType(assignment.taskType) ||
    assignmentAccessMode(assignment) !== "write" ||
    assignment.status !== "leased" ||
    lease === null ||
    lease.agentId !== input.agentId ||
    lease.sessionId !== input.sessionId ||
    Date.parse(lease.expiresAt) - input.now.getTime() <= CONVERSATION_CLAIM_FAST_PATH_MARGIN_MS
  )
    return false;
  const held = PathScopeIndex.of(assignment.expectedPaths);
  return input.paths.length > 0 && input.paths.every((path) => held.covers(path));
}
