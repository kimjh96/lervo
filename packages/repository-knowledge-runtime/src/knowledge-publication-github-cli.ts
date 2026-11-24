import { execFile } from "node:child_process";

import {
  KnowledgePublicationForgeError,
  type KnowledgePublicationForgeFailureClass,
  type KnowledgePublicationForgeOperation,
} from "./knowledge-publication-forge.js";
import { rememberedToolEnvironment } from "./tool-environment.js";

/**
 * The `gh` CLI boundary of the GitHub publication forge: running it, and reducing each failure to
 * a closed class with GitHub's bounded, redacted reason (ADR-0603).
 */
export type Runner = (args: string[], input?: string) => Promise<string>;

/**
 * Runs `gh` with the owner's login-shell PATH: under the resident's service manager the minimal
 * PATH lacks Homebrew's `gh`, and every publication failed `not_installed` (2026-11-22 onward).
 */
export function ghRunner(
  root: string,
  executable: string,
  environment: () => Promise<NodeJS.ProcessEnv> = rememberedToolEnvironment(),
): Runner {
  return async (args, input) => {
    const env = { ...(await environment()), GH_PROMPT_DISABLED: "1" };
    return new Promise((resolveRun, reject) => {
      const child = execFile(
        executable,
        args,
        {
          cwd: root,
          // The paginated publication history is the largest output; its records are bounded.
          maxBuffer: 64 * 1024 * 1024,
          timeout: 60_000,
          env,
        },
        (error, stdout, stderr) =>
          error === null ? resolveRun(stdout) : reject(Object.assign(error, { stderr })),
      );
      if (input !== undefined) child.stdin?.end(input);
    });
  };
}

export class InvalidResponse extends Error {}

// Ordered: the first matching class wins, so a refused merge names its most specific cause.
const STDERR_CLASSES: readonly [KnowledgePublicationForgeFailureClass, RegExp][] = [
  [
    "method_not_allowed",
    /(?:merge commits?|squash merges?|rebase merges?|merge method)[^\n]*not (?:allowed|enabled|permitted)|not an allowed merge method/iu,
  ],
  [
    "checks_pending",
    /status checks? .*(?:expected|pending|in progress|queued)|checks? (?:are |is )?(?:still )?(?:pending|in progress|queued)|waiting (?:for|on) (?:status )?checks?/iu,
  ],
  ["checks_failed", /status checks? .*(?:fail|error)|checks? (?:have |has )?failed/iu],
  [
    "not_mergeable",
    /not mergeable|merge conflict|cannot be merged|head branch was modified|head branch is out of date|base branch policy|match-head-commit|expected head/iu,
  ],
  // A rate limit answers 403 or 429; it clears on its own, so it must win over `auth`.
  ["rate_limited", /rate limit|abuse detection|HTTP 429|too many requests|retry-after/iu],
  [
    "auth",
    /authenticat|gh auth login|bad credentials|HTTP 40[13]|forbidden|permission|must have (?:push|write|admin)|not logged in|resource not accessible/iu,
  ],
  [
    "network",
    /could not resolve host|connection|timed? ?out|timeout|network|ECONN|ENOTFOUND|EAI_AGAIN|TLS|HTTP 5\d\d|unexpected EOF|i\/o/iu,
  ],
  ["not_found", /not found|could not find|could not resolve to|no pull requests? found|HTTP 404/iu],
];

const REASON_LIMIT = 200;

/**
 * ADR-0603: the forge's own reason, bounded to one line and with credentials redacted, so a
 * failure says what GitHub refused instead of `unknown`. It stays in this host's private
 * publication state; nothing replicates it.
 */
export function githubFailureReason(stderr: string): string | null {
  const line = stderr
    .replace(/\u001b\[[0-9;]*[A-Za-z]/gu, "")
    .split(/\r?\n/u)
    .map((text) => text.replace(/[\p{Cc}\p{Cf}]/gu, " ").trim())
    .filter((text) => text !== "")
    .join(" | ")
    .replace(/\b(?:gh[opsu]_|ghr_|github_pat_)[A-Za-z0-9_]{8,}/gu, "<token>")
    .replace(/(https?:\/\/)[^/\s@]*@/giu, "$1");
  if (line === "") return null;
  return line.length > REASON_LIMIT ? `${line.slice(0, REASON_LIMIT - 1)}…` : line;
}

/**
 * Reduces one `gh` failure to a closed class, with the forge's bounded, redacted reason.
 */
export function classifyGitHubCliFailure(error: unknown): {
  exitCode: number | null;
  failureClass: KnowledgePublicationForgeFailureClass;
  reason: string | null;
} {
  // ADR-0603: a publication remote that names no GitHub repository needs a person.
  if (error instanceof Error && error.name === "GitHubRepositoryUnresolved")
    return { exitCode: null, failureClass: "not_found", reason: error.message };
  if (error instanceof InvalidResponse || error instanceof SyntaxError)
    return { exitCode: null, failureClass: "invalid_response", reason: null };
  const value = (error ?? {}) as {
    code?: unknown;
    killed?: unknown;
    signal?: unknown;
    stderr?: unknown;
  };
  if (value.code === "ENOENT")
    return { exitCode: null, failureClass: "not_installed", reason: null };
  const exitCode = typeof value.code === "number" ? value.code : null;
  if (value.killed === true || value.signal === "SIGTERM")
    return { exitCode, failureClass: "network", reason: "gh timed out" };
  const stderr = typeof value.stderr === "string" ? value.stderr : String(value.stderr ?? "");
  const match = STDERR_CLASSES.find(([, pattern]) => pattern.test(stderr));
  return { exitCode, failureClass: match?.[0] ?? "unknown", reason: githubFailureReason(stderr) };
}

export async function guarded<T>(
  operation: KnowledgePublicationForgeOperation,
  work: () => Promise<T>,
): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof KnowledgePublicationForgeError) throw error;
    const { exitCode, failureClass, reason } = classifyGitHubCliFailure(error);
    throw new KnowledgePublicationForgeError(operation, exitCode, failureClass, {
      cause: error,
      reason,
    });
  }
}
