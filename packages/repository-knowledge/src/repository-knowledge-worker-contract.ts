/** Exact before/after text of one changed path; `unavailable` bytes are never guessed. */
export interface RepositoryKnowledgeReviewSource {
  path: string;
  before:
    | { kind: "text"; text: string }
    | { kind: "missing" }
    | { kind: "unavailable" }
    | { kind: "opaque"; contentHash: string };
  after:
    { kind: "text"; text: string } | { kind: "missing" } | { kind: "opaque"; contentHash: string };
}

export interface RepositoryKnowledgeReviewDecision {
  classification: "implementation_only" | "canonical_change_candidate" | "needs_review";
}

export interface RepositoryKnowledgeWorkerHost {
  /** The no-capability semantic review; it returns a candidate, never write authority. */
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

export class TerminalOutcome {
  constructor(
    readonly terminalState: RepositoryKnowledgeTerminalState,
    readonly failureCode: string | null,
    readonly classification: RepositoryKnowledgeReviewDecision["classification"] | null = null,
    readonly knowledgeSnapshotHash: string | null = null,
    readonly canonicalizationCandidateId: string | null = null,
  ) {}
}
