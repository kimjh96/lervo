import type { GitIndexLockStaleAttentionItemV1 } from "@lervo/application-contract";
import {
  staleGitIndexLock,
  staleGitIndexLockInstruction,
  type StaleGitIndexLock,
} from "@lervo/repository-knowledge-runtime";

/**
 * The stale Git index lock of this checkout, or null. An unreadable checkout reads as none: the
 * commit paths still report it as `git_unavailable_or_busy`, so nothing is hidden.
 */
export function readStaleGitIndexLock(repositoryRoot: string): Promise<StaleGitIndexLock | null> {
  return staleGitIndexLock(repositoryRoot).catch(() => null);
}

/** One owner item per stale lock: Lervo never deletes it, so the instruction names the file. */
export function gitIndexLockAttentionItems(
  lock: StaleGitIndexLock | null | undefined,
): GitIndexLockStaleAttentionItemV1[] {
  if (lock === null || lock === undefined) return [];
  return [
    {
      schemaVersion: 1,
      kind: "git_index_lock_stale",
      itemId: "git_index_lock_stale",
      state: "action_required",
      path: lock.path,
      ageSeconds: lock.ageSeconds,
      since: lock.modifiedAt,
      actionOwner: "user",
      requiresUserAction: true,
      blocking: false,
      instruction: staleGitIndexLockInstruction(lock),
    },
  ];
}
