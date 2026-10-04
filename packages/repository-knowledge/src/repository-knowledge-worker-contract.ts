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

export interface RepositoryKnowledgeWorkerHost {
  /** The no-capability semantic review of one sub-job; it returns a candidate, never authority. */
  review(sources: RepositoryKnowledgeReviewSource[]): Promise<RepositoryKnowledgeReviewDecision>;
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
