/**
 * Host-local settings for publishing the convergence owner's knowledge commits (ADR-0466). They
 * sit in the host configuration under `.lervo/state`, so each host chooses its own remote and
 * merge policy and the settings never replicate.
 */
export interface KnowledgePublicationSettings {
  /** Git remote that receives the publication branch, such as `origin`. */
  remote: string;
  /** Protected branch that pull requests target; never pushed to directly. */
  baseBranch: string;
  /** One rolling branch that carries only unpublished knowledge commits. */
  branch: string;
  /**
   * `when_checks_pass` merges the pull request once every reported check succeeded;
   * `never` stops at opening or updating it.
   */
  merge: "when_checks_pass" | "never";
  /** Repository-relative directory prefixes a published commit may change. */
  allowedRoots: string[];
}

export const DEFAULT_KNOWLEDGE_PUBLICATION_ROOTS = ["docs/", ".lervo/knowledge/"] as const;

const REMOTE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u;
const BRANCH = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$/u;
const ROOT = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[^\0\s]{1,127}\/$/u;

function validBranch(value: unknown): value is string {
  return (
    typeof value === "string" &&
    BRANCH.test(value) &&
    !value.includes("..") &&
    !value.endsWith("/") &&
    !value.endsWith(".lock")
  );
}

/** Null when invalid; `allowedRoots` defaults to `docs/` and `.lervo/knowledge/`. */
export function parseKnowledgePublicationSettings(
  value: unknown,
): KnowledgePublicationSettings | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  const keys = Object.keys(input);
  if (
    !keys.every((key) =>
      ["remote", "baseBranch", "branch", "merge", "allowedRoots"].includes(key),
    ) ||
    typeof input.remote !== "string" ||
    !REMOTE.test(input.remote) ||
    !validBranch(input.baseBranch) ||
    !validBranch(input.branch) ||
    input.branch === input.baseBranch ||
    (input.merge !== "when_checks_pass" && input.merge !== "never")
  )
    return null;
  const roots = input.allowedRoots ?? [...DEFAULT_KNOWLEDGE_PUBLICATION_ROOTS];
  if (
    !Array.isArray(roots) ||
    roots.length < 1 ||
    roots.length > 16 ||
    !roots.every((root) => typeof root === "string" && ROOT.test(root))
  )
    return null;
  return {
    remote: input.remote,
    baseBranch: input.baseBranch,
    branch: input.branch,
    merge: input.merge,
    allowedRoots: [...(roots as string[])],
  };
}
