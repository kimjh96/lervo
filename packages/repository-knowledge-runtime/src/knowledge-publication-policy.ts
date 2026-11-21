import type { KnowledgePublicationSettings } from "./knowledge-publication-settings.js";

/** How a forge lands a pull request on its base branch. */
export type KnowledgePublicationMergeMethod = "merge" | "squash" | "rebase";

/** Lervo prefers a merge commit, which keeps every knowledge commit; then one squash; then rebase. */
const PREFERENCE: readonly KnowledgePublicationMergeMethod[] = ["merge", "squash", "rebase"];

/**
 * ADR-0603: what the repository's own policy requires of a pull request into the base branch and
 * of pushes to the publication branch, read from the forge each publication: its repository merge
 * settings, its rulesets and its classic branch protection.
 */
export interface KnowledgePublicationPolicy {
  /** Merge methods the repository settings and every rule on the base branch allow. */
  mergeMethods: KnowledgePublicationMergeMethod[];
  /** Which rule removed each method, or why a method's setting is unknown. */
  excluded: { method: KnowledgePublicationMergeMethod; rule: string }[];
  /** Check names a rule requires to pass on the base branch. */
  requiredChecks: string[];
  /** Whether the head must be up to date with the base before it merges. */
  strict: boolean;
  /** Whether an approving review is required, which only a person can give. */
  reviewRequired: boolean;
  /** Whether a rule requires the base's merge queue, which merges with its own method. */
  mergeQueue: boolean;
  /** Requirements on merging into the base that Lervo cannot meet or does not know, by name. */
  baseRefusals: string[];
  /** Requirements on the publication branch that refuse the pushes Lervo makes, by name. */
  branchRefusals: string[];
}

/**
 * - `merge`: the method to merge with, or null when merging is left to a person.
 * - `refused`: a requirement Lervo cannot meet, named for attention; nothing is pushed.
 */
export type KnowledgePublicationPlan =
  | {
      status: "ready";
      merge: KnowledgePublicationMergeMethod | "queue" | null;
      requiredChecks: string[];
      strict: boolean;
      reviewRequired: boolean;
    }
  | { status: "refused"; detail: string };

/**
 * ADR-0603: derives how to publish from the repository's policy, before anything is pushed. A
 * requirement Lervo cannot meet, or one it does not know, is refused here by name, never
 * discovered at merge. A required review is not refused: the pull request opens and waits for a
 * person.
 */
export function planKnowledgePublication(
  policy: KnowledgePublicationPolicy,
  settings: Pick<KnowledgePublicationSettings, "merge" | "branch" | "baseBranch">,
): KnowledgePublicationPlan {
  if (policy.branchRefusals.length > 0)
    return {
      status: "refused",
      detail: `branch ${settings.branch}: ${policy.branchRefusals.join(", ")}`,
    };
  const ready = {
    requiredChecks: policy.requiredChecks,
    strict: policy.strict,
    reviewRequired: policy.reviewRequired,
  };
  if (settings.merge === "never") return { status: "ready", merge: null, ...ready };
  if (policy.baseRefusals.length > 0)
    return {
      status: "refused",
      detail: `base ${settings.baseBranch}: ${policy.baseRefusals.join(", ")}`,
    };
  if (policy.mergeQueue) return { status: "ready", merge: "queue", ...ready };
  const method = PREFERENCE.find((candidate) => policy.mergeMethods.includes(candidate));
  if (method === undefined)
    return {
      status: "refused",
      detail: `base ${settings.baseBranch}: no allowed merge method${
        policy.excluded.length === 0
          ? ""
          : ` (${policy.excluded.map(({ method: name, rule }) => `${name} by ${rule}`).join(", ")})`
      }`,
    };
  return { status: "ready", merge: method, ...ready };
}

/**
 * The forge's raw policy, before it is reduced.
 * - `repository`: each merge setting, or null when the forge did not report it.
 * - `baseRules`, `branchRules`: the active rules for each branch as the branch-rules endpoint
 *   returns them, or the reason they could not be read.
 * - `protection`, `branchProtection`: classic branch protection, null when the branch has none,
 *   or the reason its details could not be read, which is unknown and refuses.
 */
export interface KnowledgePublicationPolicyInput {
  repository: {
    allowMergeCommit: boolean | null;
    allowSquashMerge: boolean | null;
    allowRebaseMerge: boolean | null;
  };
  baseRules: readonly unknown[] | { unreadable: string };
  branchRules: readonly unknown[] | { unreadable: string };
  protection:
    | {
        requiredChecks: string[];
        strict: boolean;
        linearHistory: boolean;
        signatures: boolean;
        reviewRequired: boolean;
      }
    | null
    | { unreadable: string };
  branchProtection:
    { forcePushAllowed: boolean; signatures: boolean } | null | { unreadable: string };
}

const ALL_METHODS: readonly KnowledgePublicationMergeMethod[] = ["merge", "squash", "rebase"];

/** Rule types on the base whose effect Lervo knows; every other type refuses by name. */
const BASE_RULES = new Set([
  "pull_request",
  "required_status_checks",
  "required_linear_history",
  "required_signatures",
  "merge_queue",
  // These restrict pushes to the base itself, which Lervo never makes. `update` is not one of
  // them: a pull request's merge updates the base, so it refuses below.
  "deletion",
  "creation",
  "non_fast_forward",
]);
/** Rule types on the publication branch that leave Lervo's pushes alone. */
const HARMLESS_BRANCH_RULES = new Set([
  "deletion",
  "pull_request",
  "required_status_checks",
  "required_linear_history",
]);

function rule(value: unknown): { type: string; parameters: Record<string, unknown> } | null {
  const item = value as { type?: unknown; parameters?: unknown } | null;
  if (item === null || typeof item !== "object" || typeof item.type !== "string") return null;
  return {
    type: item.type,
    parameters:
      item.parameters !== null && typeof item.parameters === "object"
        ? (item.parameters as Record<string, unknown>)
        : {},
  };
}

/**
 * Reduces repository settings, rulesets and classic protection to one policy. Every source can
 * only narrow what is allowed: a method stays only if its setting is known to allow it and no rule
 * removes it. Signed commits on the base leave only a squash, which the forge itself signs: a
 * merge commit would bring the unsigned knowledge commits along and a rebase rewrites them
 * unsigned. A rule Lervo does not know, or rules it could not read, refuse by name.
 */
export function reduceKnowledgePublicationPolicy(
  input: KnowledgePublicationPolicyInput,
): KnowledgePublicationPolicy {
  const settings: Record<KnowledgePublicationMergeMethod, boolean | null> = {
    merge: input.repository.allowMergeCommit,
    squash: input.repository.allowSquashMerge,
    rebase: input.repository.allowRebaseMerge,
  };
  const allowed = new Set(ALL_METHODS.filter((method) => settings[method] === true));
  const excluded: { method: KnowledgePublicationMergeMethod; rule: string }[] = ALL_METHODS.filter(
    (method) => settings[method] !== true,
  ).map((method) => ({
    method,
    rule: settings[method] === null ? "repository settings (unknown)" : "repository settings",
  }));
  const remove = (method: KnowledgePublicationMergeMethod, by: string) => {
    if (!allowed.delete(method)) return;
    excluded.push({ method, rule: by });
  };
  const baseRefusals = new Set<string>();
  const unreadable = (value: object | null): value is { unreadable: string } =>
    value !== null && "unreadable" in value;
  if (unreadable(input.protection))
    baseRefusals.add(`protection unreadable (${input.protection.unreadable})`);
  const protection = unreadable(input.protection) ? null : input.protection;
  const requiredChecks = new Set(protection?.requiredChecks ?? []);
  let strict = protection?.strict ?? false;
  let reviewRequired = protection?.reviewRequired ?? false;
  let mergeQueue = false;
  if (protection?.linearHistory === true) remove("merge", "required_linear_history");
  if (protection?.signatures === true) {
    remove("merge", "required_signatures");
    remove("rebase", "required_signatures");
  }
  if (!Array.isArray(input.baseRules))
    baseRefusals.add(
      `rules unreadable (${(input.baseRules as { unreadable: string }).unreadable})`,
    );
  for (const value of Array.isArray(input.baseRules) ? input.baseRules : []) {
    const item = rule(value);
    if (item === null) continue;
    if (item.type === "update") {
      baseRefusals.add("update (only bypass actors may update the base, including by a merge)");
      continue;
    }
    if (!BASE_RULES.has(item.type)) {
      baseRefusals.add(item.type);
      continue;
    }
    switch (item.type) {
      case "pull_request": {
        const methods = item.parameters.allowed_merge_methods;
        if (Array.isArray(methods))
          for (const method of ALL_METHODS)
            if (!methods.includes(method)) remove(method, "pull_request.allowed_merge_methods");
        const count = Number(item.parameters.required_approving_review_count ?? 0);
        if (count > 0 || item.parameters.require_code_owner_review === true) reviewRequired = true;
        break;
      }
      case "required_status_checks": {
        const checks = item.parameters.required_status_checks;
        if (Array.isArray(checks))
          for (const check of checks) {
            const context = (check as { context?: unknown } | null)?.context;
            if (typeof context === "string" && context !== "") requiredChecks.add(context);
          }
        if (item.parameters.strict_required_status_checks_policy === true) strict = true;
        break;
      }
      case "required_linear_history":
        remove("merge", "required_linear_history");
        break;
      case "required_signatures":
        remove("merge", "required_signatures");
        remove("rebase", "required_signatures");
        break;
      case "merge_queue":
        mergeQueue = true;
        break;
    }
  }
  const branchRefusals = new Set<string>();
  if (!Array.isArray(input.branchRules))
    branchRefusals.add(
      `rules unreadable (${(input.branchRules as { unreadable: string }).unreadable})`,
    );
  for (const value of Array.isArray(input.branchRules) ? input.branchRules : []) {
    const item = rule(value);
    // Lervo rebuilds the publication branch on each new base, creates it when it is gone, and its
    // commits are unsigned; any rule it does not know refuses too.
    if (item !== null && !HARMLESS_BRANCH_RULES.has(item.type)) branchRefusals.add(item.type);
  }
  if (unreadable(input.branchProtection))
    branchRefusals.add(`protection unreadable (${input.branchProtection.unreadable})`);
  else if (input.branchProtection !== null) {
    if (!input.branchProtection.forcePushAllowed) branchRefusals.add("protection: force pushes");
    if (input.branchProtection.signatures) branchRefusals.add("protection: required_signatures");
  }
  return {
    mergeMethods: ALL_METHODS.filter((method) => allowed.has(method)),
    excluded,
    requiredChecks: [...requiredChecks].sort(),
    strict,
    reviewRequired,
    mergeQueue,
    baseRefusals: [...baseRefusals].sort(),
    branchRefusals: [...branchRefusals].sort(),
  };
}
