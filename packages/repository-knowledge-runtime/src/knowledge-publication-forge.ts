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
 * - `pending`: at least one check has not finished, or none has succeeded yet.
 * - `passed`: every reported check finished with success, except checks the workflow skipped
 *   because they do not apply to this pull request, and at least one succeeded.
 * - `failed`: at least one check finished with any other conclusion, including cancelled,
 *   neutral, timed out, stale, or action required.
 */
export type KnowledgePublicationChecks =
  | { state: "pending"; total: number }
  | { state: "passed"; total: number }
  | { state: "failed"; total: number; failed: number };

export type KnowledgePublicationForgeOperation =
  "find" | "create" | "update" | "view" | "close" | "checks" | "merge";

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
  checks(input: { number: number; headSha: string }): Promise<KnowledgePublicationChecks>;
  /** Merges with a merge commit only if the head is still exactly `headSha`. */
  merge(input: { number: number; headSha: string }): Promise<void>;
}
