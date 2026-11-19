/**
 * ADR-0594: skill directories hold executable agent instructions. A prose rewrite can change what
 * an agent does, so background normalization never selects them, and publication admits a change
 * there only from the practice materialization that owns those files.
 */
export const NORMALIZATION_PROTECTED_ROOTS = [
  ".agents/skills",
  ".claude/skills",
  ".codex/skills",
] as const;

const PRACTICE_TRAILER = /^Lervo-Practice-Candidate: \S+$/mu;

/** Whether background normalization may rewrite the path, whatever the delegation's roots say. */
export function normalizationMayRewrite(path: string): boolean {
  return !NORMALIZATION_PROTECTED_ROOTS.some(
    (root) => path === root || path.startsWith(`${root}/`),
  );
}

/** Whether a knowledge commit is the practice materialization that writes skill files. */
export function practiceMaterializationCommit(commit: { body: string }): boolean {
  return PRACTICE_TRAILER.test(commit.body);
}
