/**
 * Host-local settings for publishing the convergence owner's knowledge commits (ADR-0466). They
 * sit in the host configuration under `.lervo/state`, so each host chooses its own remote and
 * merge policy and the settings never replicate.
 */
interface KnowledgePublicationTarget {
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
  /**
   * ADR-0596: exact check or status names that never block a merge, such as a deployment preview
   * that cannot verify the `Lervo Knowledge` author. Only the operator sets it; derivation keeps it.
   */
  checks?: { ignore: string[] };
}

/**
 * Which paths a published commit may change. `scope: "delegation"` (ADR-0473) follows the
 * knowledge write scope: the active delegation's canonical and normalization roots plus
 * Lervo-managed knowledge state. `allowedRoots` holds fixed operator-chosen directory prefixes.
 */
export type KnowledgePublicationSettings = KnowledgePublicationTarget &
  ({ scope: "delegation"; allowedRoots?: never } | { scope?: never; allowedRoots: string[] });

/** The fixed roots a configuration without `scope` or `allowedRoots` has always meant. */
export const DEFAULT_KNOWLEDGE_PUBLICATION_ROOTS = ["docs/", ".lervo/knowledge/"] as const;

const REMOTE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u;
const BRANCH = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$/u;
const ROOT = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[^\0\s]{1,127}\/$/u;
/** At most 8 names of 1 to 100 printable characters, so the 4 KiB host file always fits them. */
export const MAXIMUM_IGNORED_PUBLICATION_CHECKS = 8;
const CHECK_NAME = /^(?=\S)(?!.*\s$)[^\p{Cc}\p{Cf}]{1,100}$/u;

/** The `checks` object, or null when present and invalid; undefined when absent. */
function parseChecks(value: unknown): { ignore: string[] } | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  const ignore = input.ignore;
  if (
    Object.keys(input).some((key) => key !== "ignore") ||
    !Array.isArray(ignore) ||
    ignore.length < 1 ||
    ignore.length > MAXIMUM_IGNORED_PUBLICATION_CHECKS ||
    !ignore.every((name) => typeof name === "string" && CHECK_NAME.test(name)) ||
    new Set(ignore).size !== ignore.length
  )
    return null;
  return { ignore: [...(ignore as string[])] };
}

function validBranch(value: unknown): value is string {
  return (
    typeof value === "string" &&
    BRANCH.test(value) &&
    !value.includes("..") &&
    !value.endsWith("/") &&
    !value.endsWith(".lock")
  );
}

/**
 * Null when invalid. Without `scope`, `allowedRoots` defaults to `docs/` and `.lervo/knowledge/`;
 * `scope: "delegation"` excludes `allowedRoots`.
 */
export function parseKnowledgePublicationSettings(
  value: unknown,
): KnowledgePublicationSettings | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  const keys = Object.keys(input);
  if (
    !keys.every((key) =>
      ["remote", "baseBranch", "branch", "merge", "allowedRoots", "scope", "checks"].includes(key),
    ) ||
    typeof input.remote !== "string" ||
    !REMOTE.test(input.remote) ||
    !validBranch(input.baseBranch) ||
    !validBranch(input.branch) ||
    input.branch === input.baseBranch ||
    (input.merge !== "when_checks_pass" && input.merge !== "never")
  )
    return null;
  const checks = parseChecks(input.checks);
  if (checks === null) return null;
  const target: KnowledgePublicationTarget = {
    remote: input.remote,
    baseBranch: input.baseBranch,
    branch: input.branch,
    merge: input.merge,
    ...(checks === undefined ? {} : { checks }),
  };
  if ("scope" in input)
    return input.scope === "delegation" && !("allowedRoots" in input)
      ? { ...target, scope: "delegation" }
      : null;
  const roots = input.allowedRoots ?? [...DEFAULT_KNOWLEDGE_PUBLICATION_ROOTS];
  if (
    !Array.isArray(roots) ||
    roots.length < 1 ||
    roots.length > 16 ||
    !roots.every((root) => typeof root === "string" && ROOT.test(root))
  )
    return null;
  return { ...target, allowedRoots: [...(roots as string[])] };
}

/**
 * ADR-0473 migration of a Lervo-derived publication setting: the fixed default roots that
 * derivation used to write become the delegation scope. Anything else is returned unchanged; the
 * caller applies this only to configurations Lervo itself wrote.
 */
export function migrateDerivedKnowledgePublicationSettings(
  settings: KnowledgePublicationSettings,
): KnowledgePublicationSettings {
  if (
    settings.scope === "delegation" ||
    settings.allowedRoots.length !== DEFAULT_KNOWLEDGE_PUBLICATION_ROOTS.length ||
    !DEFAULT_KNOWLEDGE_PUBLICATION_ROOTS.every(
      (root, index) => settings.allowedRoots[index] === root,
    )
  )
    return settings;
  return {
    remote: settings.remote,
    baseBranch: settings.baseBranch,
    branch: settings.branch,
    merge: settings.merge,
    ...(settings.checks === undefined ? {} : { checks: settings.checks }),
    scope: "delegation",
  };
}

/** ADR-0596: a probed setting keeps the operator's `checks`, which a probe never derives. */
export function withOperatorPublicationChecks(
  settings: KnowledgePublicationSettings,
  current: KnowledgePublicationSettings | undefined,
): KnowledgePublicationSettings {
  if (current?.checks === undefined) return settings;
  return { ...settings, checks: current.checks };
}
