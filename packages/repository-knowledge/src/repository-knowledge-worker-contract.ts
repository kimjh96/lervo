/**
 * Exact before/after text of one reviewable changed path; `unavailable` bytes are never guessed.
 * Binary, oversize, and generated paths are skipped before review (ADR-0457).
 */
export interface RepositoryKnowledgeReviewSource {
  path: string;
  before: { kind: "text"; text: string } | { kind: "missing" } | { kind: "unavailable" };
  after: { kind: "text"; text: string } | { kind: "missing" };
}

export interface RepositoryKnowledgeReviewDecision {
  classification: "implementation_only" | "canonical_change_candidate" | "needs_review";
}

/** Coordinates of one sub-job review, so a governed host can budget and attribute the call. */
export interface RepositoryKnowledgeReviewJob {
  changeEventId: string;
  destinationId: string;
  attemptCount: number;
  subJobIndex: number;
  subJobCount: number;
  /** The deterministic resolution this job will record; it scopes the review budget. */
  resolutionEventId: string;
}

/** Non-retryable review failures; each settles the job as `attention_required` with its code. */
export type RepositoryKnowledgeReviewFailureCode =
  | "knowledge_authority_unavailable"
  | "knowledge_review_budget_exhausted"
  | "knowledge_provider_paused"
  | "knowledge_usage_unavailable";

export class RepositoryKnowledgeReviewError extends Error {
  constructor(
    readonly code: RepositoryKnowledgeReviewFailureCode,
    options?: ErrorOptions,
  ) {
    super(`The repository knowledge review cannot proceed: ${code}.`, options);
    this.name = "RepositoryKnowledgeReviewError";
  }
}

export interface RepositoryKnowledgeWorkerHost {
  /** The no-capability semantic review of one sub-job; it returns a candidate, never authority. */
  review(
    sources: RepositoryKnowledgeReviewSource[],
    job: RepositoryKnowledgeReviewJob,
  ): Promise<RepositoryKnowledgeReviewDecision>;
  assertReviewContextCurrent?(): void;
  /** Read-only knowledge lifecycle check after the review. */
  inspectKnowledge(): Promise<{ current: boolean; snapshotHash: string }>;
}

export type RepositoryKnowledgeTerminalState =
  "current" | "pending_review" | "stale" | "attention_required";

export interface RepositoryKnowledgeJobOutcome {
  changeEventId: string;
  terminalState: RepositoryKnowledgeTerminalState | "retry_scheduled";
  failureCode: string | null;
}

/** Per-file degradation and sub-job coordinates recorded on the resolution event. */
export interface RepositoryKnowledgeIntakeSummary {
  skippedPathCount: number;
  skippedReasons: ("skipped_oversize" | "skipped_binary" | "skipped_generated")[];
  /** The sub-job whose review decided a non-current outcome; null when none did. */
  subJobIndex: number | null;
  subJobCount: number;
}

export class TerminalOutcome {
  constructor(
    readonly terminalState: RepositoryKnowledgeTerminalState,
    readonly failureCode: string | null,
    readonly classification: RepositoryKnowledgeReviewDecision["classification"] | null = null,
    readonly knowledgeSnapshotHash: string | null = null,
    readonly canonicalizationCandidateId: string | null = null,
  ) {}
}
