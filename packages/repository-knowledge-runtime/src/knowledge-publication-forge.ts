/**
 * The code-review host that receives knowledge publication pull requests. The GitHub CLI adapter
 * implements it; tests use an in-memory fake. Every method throws on any transport failure, the
 * GitHub adapter always as a `KnowledgePublicationForgeError`.
 */
export interface KnowledgePublicationPullRequest {
  number: number;
  url: string;
  state: "open" | "merged" | "closed";
  headSha: string;
  title: string;
  body: string;
}

/**
 * One check that blocks a merge, named so attention can say what failed (ADR-0596).
 * - `kind`: `check_run` is a GitHub Actions or app check run; `status` is an outside commit status,
 *   such as a deployment preview, which the publisher cannot rerun.
 * - `conclusion`: the forge's conclusion, or `not_run` for a check run that finished without ever
 *   starting, such as a job GitHub refused to start for billing.
 * - `runId`, `jobId`: the Actions run and job behind a check run, when its details link names them.
 */
export interface KnowledgePublicationCheckFailure {
  name: string;
  kind: "check_run" | "status";
  conclusion: string;
  runId: number | null;
  /** The Actions job behind a check run, used only to tell a job that never started. */
  jobId: number | null;
}

/** Bounds the failures one summary carries; the count still covers every failed check. */
export const MAXIMUM_NAMED_CHECK_FAILURES = 8;

/**
 * - `pending`: at least one check has not finished, or none has succeeded yet.
 * - `passed`: every reported check finished with success, except checks the workflow skipped
 *   because they do not apply to this pull request, and at least one succeeded.
 * - `failed`: at least one check finished with any other conclusion, including cancelled,
 *   neutral, timed out, stale, or action required.
 */
export type KnowledgePublicationChecks =
  | { state: "pending"; total: number }
  | { state: "passed"; total: number }
  | {
      state: "failed";
      total: number;
      failed: number;
      failures: KnowledgePublicationCheckFailure[];
    };

export type KnowledgePublicationForgeOperation =
  "find" | "create" | "update" | "view" | "close" | "checks" | "rerun" | "merge";

/**
 * A closed, privacy-safe cause of one forge failure; the forge's own message never leaves it.
 * `checks_pending` means the forge refused because checks have not finished, which is not a
 * failure of the publication.
 */
export type KnowledgePublicationForgeFailureClass =
  | "auth"
  | "network"
  | "not_found"
  | "not_mergeable"
  | "checks_pending"
  | "checks_failed"
  | "invalid_response"
  | "not_installed"
  | "unknown";

export class KnowledgePublicationForgeError extends Error {
  constructor(
    readonly operation: KnowledgePublicationForgeOperation,
    readonly exitCode: number | null,
    readonly failureClass: KnowledgePublicationForgeFailureClass,
    options?: ErrorOptions,
  ) {
    super(`Knowledge publication forge ${operation} failed: ${failureClass}.`, options);
    this.name = "KnowledgePublicationForgeError";
  }

  /** Bounded detail for publication state, such as `gh merge exit 1 not_mergeable`. */
  get detail(): string {
    return `gh ${this.operation} exit ${this.exitCode ?? "unknown"} ${this.failureClass}`;
  }
}

export interface KnowledgePublicationForge {
  findPullRequest(input: {
    head: string;
    base: string;
  }): Promise<KnowledgePublicationPullRequest | null>;
  createPullRequest(input: {
    head: string;
    base: string;
    title: string;
    body: string;
  }): Promise<KnowledgePublicationPullRequest>;
  updatePullRequest(input: { number: number; title: string; body: string }): Promise<void>;
  viewPullRequest(number: number): Promise<KnowledgePublicationPullRequest>;
  /** Closes an open pull request with an explanatory comment; the branch stays for the next push. */
  closePullRequest(input: { number: number; comment: string }): Promise<void>;
  /** Checks for the exact head; `ignore` lists exact check or status names that never block. */
  checks(input: {
    number: number;
    headSha: string;
    ignore?: readonly string[];
  }): Promise<KnowledgePublicationChecks>;
  /**
   * Starts the failed jobs of these Actions runs again on the same head (ADR-0596). A run GitHub
   * no longer reruns, such as one older than a month, is retriggered by reopening the pull
   * request, which starts its pull request workflows on the unchanged head.
   */
  rerunFailedChecks(input: { number: number; runIds: readonly number[] }): Promise<void>;
  /** Merges with a merge commit only if the head is still exactly `headSha`. */
  merge(input: { number: number; headSha: string }): Promise<void>;
}
