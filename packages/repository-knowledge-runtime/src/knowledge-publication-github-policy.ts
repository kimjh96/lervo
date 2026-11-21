import type { KnowledgePublicationMergeGate } from "./knowledge-publication-forge.js";
import { classifyGitHubCliFailure, type Runner } from "./knowledge-publication-github-cli.js";
import type { KnowledgePublicationPolicyInput } from "./knowledge-publication-policy.js";

/**
 * GitHub's merge state, review decision, draft flag and merge queue, reduced to what still stands
 * before a merge. A base with a merge queue, including one set in classic protection that no rule
 * reports, is entered through the queue instead of merged (ADR-0603).
 */
export function mergeGate(
  state: unknown,
  review: unknown,
  queue: { isDraft?: unknown; isInMergeQueue?: unknown; isMergeQueueEnabled?: unknown } = {},
): KnowledgePublicationMergeGate {
  if (queue.isInMergeQueue === true) return "queued";
  if (queue.isDraft === true || state === "DRAFT") return "draft";
  if (review === "REVIEW_REQUIRED" || review === "CHANGES_REQUESTED") return "review_required";
  if (queue.isMergeQueueEnabled === true && state !== "DIRTY" && state !== "UNKNOWN")
    return "queue";
  switch (state) {
    // UNSTABLE: only checks the policy does not require are failing, and GitHub merges.
    case "CLEAN":
    case "HAS_HOOKS":
    case "UNSTABLE":
      return "ready";
    case "BEHIND":
      return "behind";
    case "BLOCKED":
      return "blocked";
    case "DIRTY":
      return "conflict";
    default:
      return "unknown";
  }
}

function stderrOf(error: unknown): string {
  const stderr = (error as { stderr?: unknown } | null)?.stderr;
  return typeof stderr === "string" ? stderr : String(stderr ?? "");
}

/**
 * GitHub's answer when the repository's plan has no rulesets or branch protection at all, such as
 * a private repository on a free plan: nothing of that kind can apply, so it reads as none.
 */
const FEATURE_UNAVAILABLE = /Upgrade to GitHub Pro|make this repository public to enable/iu;

/** A JSON object per line, as `gh api --paginate --jq '.[]'` prints every page's items. */
export function jsonLines(output: string): unknown[] {
  return output
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line) as unknown);
}

const flag = (value: unknown): boolean | null => (typeof value === "boolean" ? value : null);

export async function readGitHubPolicy(
  run: Runner,
  base: string,
  branch: string,
): Promise<KnowledgePublicationPolicyInput> {
  const repository = JSON.parse(
    await run([
      "api",
      "repos/{owner}/{repo}",
      "--jq",
      "{allowMergeCommit: .allow_merge_commit, allowSquashMerge: .allow_squash_merge, allowRebaseMerge: .allow_rebase_merge}",
    ]),
  ) as Record<string, unknown>;
  // The endpoint answers an empty list for a branch without rules, so a refusal (404 for a host
  // that may not read the repository's rules, 403) proves nothing and reads as unknown. Every
  // page's items print one per line, which gh releases before 2.48 support (no `--slurp`).
  const rules = async (name: string): Promise<readonly unknown[] | { unreadable: string }> => {
    try {
      return jsonLines(
        await run([
          "api",
          "--paginate",
          `repos/{owner}/{repo}/rules/branches/${encodeURIComponent(name)}`,
          "--jq",
          ".[]",
        ]),
      );
    } catch (error) {
      if (FEATURE_UNAVAILABLE.test(stderrOf(error))) return [];
      const { failureClass } = classifyGitHubCliFailure(error);
      if (failureClass === "not_found" || failureClass === "auth")
        return { unreadable: failureClass };
      throw error;
    }
  };
  const protection = await readProtection(run, base, false, (value) => {
    const checks = value.required_status_checks;
    const contexts = [
      ...(Array.isArray(checks?.contexts) ? (checks.contexts as unknown[]) : []),
      ...(Array.isArray(checks?.checks)
        ? (checks.checks as { context?: unknown }[]).map((check) => check?.context)
        : []),
    ].filter((context): context is string => typeof context === "string" && context !== "");
    const reviews = value.required_pull_request_reviews;
    return {
      requiredChecks: [...new Set(contexts)],
      strict: checks?.strict === true,
      linearHistory: value.required_linear_history?.enabled === true,
      signatures: value.required_signatures?.enabled === true,
      reviewRequired:
        reviews !== undefined &&
        (Number(reviews.required_approving_review_count ?? 0) > 0 ||
          reviews.require_code_owner_reviews === true),
    };
  });
  // The publication branch's own protection can forbid the force pushes and unsigned commits
  // Lervo makes. Before its first push it does not exist, and nothing protects it yet.
  const branchProtection = await readProtection(run, branch, true, (value) => ({
    forcePushAllowed: value.allow_force_pushes?.enabled === true,
    signatures: value.required_signatures?.enabled === true,
  }));
  return {
    repository: {
      // A setting the forge did not report is unknown, never allowed.
      allowMergeCommit: flag(repository.allowMergeCommit),
      allowSquashMerge: flag(repository.allowSquashMerge),
      allowRebaseMerge: flag(repository.allowRebaseMerge),
    },
    baseRules: await rules(base),
    branchRules: await rules(branch),
    protection,
    branchProtection,
  };
}

type Protection = Record<string, Record<string, unknown> | undefined>;

/**
 * ADR-0603: one branch's classic protection. The branch's own `protected` flag needs no admin
 * rights and says whether there is any; when there is, its details need them, and details the host
 * may not read are unknown, never none.
 */
async function readProtection<T>(
  run: Runner,
  name: string,
  absentIsNone: boolean,
  reduce: (value: Protection) => T,
): Promise<T | null | { unreadable: string }> {
  const branch = `repos/{owner}/{repo}/branches/${encodeURIComponent(name)}`;
  const unreadable = (error: unknown) => {
    const { failureClass } = classifyGitHubCliFailure(error);
    if (failureClass === "not_found" || failureClass === "auth")
      return { unreadable: failureClass };
    throw error;
  };
  let protectedFlag: string;
  try {
    protectedFlag = (await run(["api", branch, "--jq", ".protected"])).trim();
  } catch (error) {
    if (absentIsNone && /Branch not found/iu.test(stderrOf(error))) return null;
    return unreadable(error);
  }
  if (protectedFlag === "false") return null;
  try {
    return reduce(JSON.parse(await run(["api", `${branch}/protection`])) as Protection);
  } catch (error) {
    // Rulesets alone also mark a branch protected; their rules are read separately.
    if (/Branch not protected/iu.test(stderrOf(error)) || FEATURE_UNAVAILABLE.test(stderrOf(error)))
      return null;
    return unreadable(error);
  }
}
