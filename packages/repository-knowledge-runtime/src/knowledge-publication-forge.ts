import type {
  KnowledgePublicationMergeMethod,
  KnowledgePublicationPolicy,
} from "./knowledge-publication-policy.js";

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
  /** ADR-0603: the commit a merge created, whatever its method; null until merged. */
  mergeCommit: string | null;
}

/**
 * ADR-0607: one pull request of the publication branch, closed (merged or not) or, with `open`,
 * reopened, as the forge reports it now. `record` is the body's publication record block, or the whole body; `headSha` is the
 * head the pull request had when it closed.
 */
export interface KnowledgePublicationHistoryEntry {
  number: number;
  merged: boolean;
  headSha: string;
  /** The commit the merge created; null while unmerged, or while the forge has not reported it. */
  mergeCommit: string | null;
  /** When it merged, by the forge's clock; null while unmerged. */
  mergedAt: string | null;
  /** When the forge last changed it, which bounds an incremental read. */
  updatedAt: string;
  record: string;
  /** Whether Lervo marked it closed by itself; a cached entry keeps only this of its record. */
  closedByLervo?: boolean;
  /** Open again since it closed; such a pull request leaves the closed history. */
  open?: boolean;
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
 * Why checks are pending (ADR-0603): `running` (one has not finished, including one stuck queued),
 * `none` (no check reported for the head), `skipped_only` (every reported check was skipped), or
 * `head_moved` (the forge still reports another head).
 */
export type KnowledgePublicationPendingReason = "running" | "none" | "skipped_only" | "head_moved";

/**
 * - `pending`: at least one check has not finished, or none has succeeded yet.
 * - `passed`: every reported check finished with success, except checks the workflow skipped
 *   because they do not apply to this pull request, and at least one succeeded.
 * - `failed`: at least one check finished with any other conclusion, including cancelled,
 *   neutral, timed out, stale, or action required.
 */
export type KnowledgePublicationChecks =
  | { state: "pending"; total: number; reason: KnowledgePublicationPendingReason }
  | { state: "passed"; total: number }
  | {
      state: "failed";
      total: number;
      failed: number;
      failures: KnowledgePublicationCheckFailure[];
    };

export type KnowledgePublicationForgeOperation =
  | "find"
  | "create"
  | "update"
  | "view"
  | "close"
  | "checks"
  | "rerun"
  | "merge"
  | "policy"
  | "gate"
  | "history";

/**
 * ADR-0603: what still stands between a pull request whose checks passed and its merge, as the
 * forge computes it.
 * - `behind`: the base moved and the policy requires the head to be up to date.
 * - `review_required`: an approving review is required, which only a person can give.
 * - `blocked`: another requirement, such as a required check that has not reported, is unmet.
 * - `conflict`: the head no longer merges cleanly.
 * - `draft`: the pull request is a draft, which only a person marks ready.
 * - `queue`: the base requires a merge queue; the publisher enqueues instead of merging.
 * - `queued`: the pull request is already in the merge queue.
 * - `unknown`: the forge has not computed it yet.
 */
export type KnowledgePublicationMergeGate =
  | "ready"
  | "behind"
  | "review_required"
  | "blocked"
  | "conflict"
  | "draft"
  | "queue"
  | "queued"
  | "unknown";

/**
 * A closed, privacy-safe cause of one forge failure; the forge's own message never leaves it.
 * `checks_pending` means the forge refused because checks have not finished, which is not a
 * failure of the publication.
 */
export type KnowledgePublicationForgeFailureClass =
  | "auth"
  | "rate_limited"
  | "network"
  | "not_found"
  | "not_mergeable"
  | "checks_pending"
  | "checks_failed"
  | "invalid_response"
  | "not_installed"
  | "method_not_allowed"
  | "unknown";

/** Classes a later attempt can clear on its own; the others need a person or a policy change. */
export const TRANSIENT_FORGE_FAILURES: ReadonlySet<KnowledgePublicationForgeFailureClass> = new Set(
  ["network", "rate_limited", "checks_pending", "not_mergeable", "unknown"],
);

export class KnowledgePublicationForgeError extends Error {
  constructor(
    readonly operation: KnowledgePublicationForgeOperation,
    readonly exitCode: number | null,
    readonly failureClass: KnowledgePublicationForgeFailureClass,
    options?: ErrorOptions & {
      /** The forge's own words, already bounded and redacted; kept only in local state. */
      reason?: string | null;
    },
  ) {
    super(`Knowledge publication forge ${operation} failed: ${failureClass}.`, options);
    this.name = "KnowledgePublicationForgeError";
    this.reason = options?.reason ?? null;
  }

  readonly reason: string | null;

  /**
   * Bounded detail for publication state, such as `gh merge exit 1 not_mergeable`, followed by
   * the forge's own reason when it gave one (ADR-0603).
   */
  get detail(): string {
    const head = `gh ${this.operation} exit ${this.exitCode ?? "unknown"} ${this.failureClass}`;
    return this.reason === null ? head : `${head}: ${this.reason}`;
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
  /**
   * ADR-0603: every closed pull request from `head` into `base`, merged or not, however many. What
   * is published is derived from these, so any host answers the same from GitHub alone.
   */
  publicationHistory(input: {
    head: string;
    base: string;
    /** Only pull requests the forge changed at or after this instant; absent reads them all. */
    since?: string;
  }): Promise<KnowledgePublicationHistoryEntry[]>;
  /** ADR-0607: the repository the forge targets, which keys what is cached of its history. */
  repository(): Promise<string>;
  /**
   * ADR-0603: how a closed, unmerged pull request was closed. GitHub also closes one whose head
   * branch was deleted; that is no decision about its commits, so they are published again.
   */
  closureCause(number: number): Promise<"person" | "branch_deleted">;
  /** Closes an open pull request with an explanatory comment; the branch stays for the next push. */
  closePullRequest(input: { number: number; comment: string }): Promise<void>;
  /**
   * Checks for the exact head; `ignore` lists exact commit status names that never block, and a
   * `required` check that has not reported keeps the result pending (ADR-0603).
   */
  checks(input: {
    number: number;
    headSha: string;
    ignore?: readonly string[];
    required?: readonly string[];
  }): Promise<KnowledgePublicationChecks>;
  /** ADR-0603: the repository policy for pull requests into `base` and pushes to `branch`. */
  policy(input: { base: string; branch: string }): Promise<KnowledgePublicationPolicy>;
  /** ADR-0603: what still stands between the pull request and its merge, once its checks passed. */
  gate(number: number): Promise<KnowledgePublicationMergeGate>;
  /**
   * Starts the failed jobs of these Actions runs again on the same head (ADR-0596). When GitHub
   * refuses only because a run is too old to retry, the pull request is closed and reopened, which
   * starts its pull request workflows on the unchanged head; a failed reopen is tried once more.
   * Any other refusal throws without closing anything.
   */
  rerunFailedChecks(input: { number: number; runIds: readonly number[] }): Promise<void>;
  /**
   * Merges with `method` only if the head is still exactly `headSha`; `queue` adds it to the base's
   * merge queue instead, which merges with its own method.
   */
  merge(input: {
    number: number;
    headSha: string;
    method: KnowledgePublicationMergeMethod | "queue";
  }): Promise<void>;
}
