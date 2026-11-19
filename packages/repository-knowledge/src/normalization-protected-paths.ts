/**
 * ADR-0594: skill directories hold executable agent instructions. A prose rewrite can change what
 * an agent does, so they are never eligible for normalization: they are never pending, never
 * normalization debt, and an existing normalization record for them is ignored, not regenerated.
 */
export const NORMALIZATION_PROTECTED_ROOTS = [
  ".agents/skills",
  ".claude/skills",
  ".codex/skills",
] as const;

/** Whether background normalization may rewrite the path, whatever a delegation's roots say. */
export function normalizationMayRewrite(path: string): boolean {
  return !NORMALIZATION_PROTECTED_ROOTS.some(
    (root) => path === root || path.startsWith(`${root}/`),
  );
}
