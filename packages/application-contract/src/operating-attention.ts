export type OperatingAttentionActionOwnerV1 = "agent" | "reviewer" | "user" | "unassigned";

interface OperatingAttentionItemBaseV1 {
  schemaVersion: 1;
  itemId: string;
  actionOwner: OperatingAttentionActionOwnerV1;
  requiresUserAction: boolean;
  blocking: boolean;
  instruction: string;
}

/**
 * Consequence class of a workstream approval or decision. Every class is consequential; a decision
 * has no structured class and is `unclassified`. Free text is never classified.
 */
export type WorkstreamItemConsequenceV1 =
  "repository_write" | "deployment" | "external_effect" | "unclassified";

/**
 * Workstream items become `stale` when the snapshot is older than the configured age or its
 * recorded repository HEAD is too far behind. A stale item is never blocking, never requires user
 * action, and instructs re-verification instead of presentation as current.
 */
export interface WorkstreamDecisionAttentionItemV1 extends OperatingAttentionItemBaseV1 {
  kind: "workstream_decision";
  state: "pending" | "stale";
  consequence: WorkstreamItemConsequenceV1;
  decisionId: string;
  question: string;
  choices: Array<{ choiceId: string; label: string; consequence: string }>;
  recommendedChoiceId: string | null;
}

export interface WorkstreamApprovalAttentionItemV1 extends OperatingAttentionItemBaseV1 {
  kind: "workstream_approval";
  state: "pending" | "stale";
  consequence: WorkstreamItemConsequenceV1;
  approvalId: string;
  approvalKind: "repository_bytes" | "managed_write" | "external_action" | "deployment";
  summary: string;
  bindingHash: string;
}

export interface WorkstreamBlockerAttentionItemV1 extends OperatingAttentionItemBaseV1 {
  kind: "workstream_blocker";
  state: "blocked" | "stale";
  blockerIndex: number;
  summary: string;
}

export interface CanonicalizationAttentionItemV1 extends OperatingAttentionItemBaseV1 {
  kind: "canonicalization_review";
  state: "candidate" | "pending" | "stale";
  candidateId: string;
  candidateHash: string;
  sourcePaths: string[];
  responsibilities: Array<
    | "behavioral_instruction"
    | "architecture_or_specification"
    | "product_or_decision"
    | "executable_verification"
    | "mutable_continuation"
  >;
  recommendedRoots: string[];
  outcomeKind: "no_durable_change" | "canonical_update" | "review_draft" | null;
  proposedTargetPaths: string[];
  hasProposedContent: boolean;
  createdAt: string;
}

export interface KnowledgeLifecycleAttentionItemV1 extends OperatingAttentionItemBaseV1 {
  kind: "knowledge_lifecycle";
  state: "action_required";
  issueCode: string;
  detail: string | null;
}

/** One open repository replica divergence identity (ADR-0456); at most one per replica. */
export interface RepositoryReplicaDivergenceAttentionItemV1 extends OperatingAttentionItemBaseV1 {
  kind: "repository_replica_divergence";
  state: "action_required";
  replicaId: string;
  divergenceId: string;
  reason: "no_common_history" | "conflicting_paths" | "merge_unavailable";
  conflictPathCount: number;
  conflictPaths: string[];
  openedAt: string;
}

/**
 * A verified document freshness candidate that needs the owner (ADR-0463): user-owned bytes, a
 * safety or policy line, an archive, or a hunk held until the Tier 0 cross-check exists.
 */
export interface DocumentFreshnessCandidateAttentionItemV1 extends OperatingAttentionItemBaseV1 {
  kind: "document_freshness_candidate";
  state: "waiting_authority" | "verified_pending_cross_check" | "partially_applied";
  candidateId: string;
  documentPath: string;
  priorityClass: "safety" | "entrypoint" | "canonical" | "other";
  changeClasses: Array<"factual_reference" | "statement" | "safety_or_policy" | "archive">;
  hunkCount: number;
}

/** Informational notice of an apply; it resolves on acknowledgement or after 24 hours. */
export interface DocumentFreshnessAppliedAttentionItemV1 extends OperatingAttentionItemBaseV1 {
  kind: "document_freshness_applied";
  state: "applied" | "partially_applied";
  candidateId: string;
  documentPath: string;
  approvalSource: "lervo_managed" | "principal_mandate" | "owner";
  commitHash: string | null;
  revertInstruction: string;
}

/** The freshness loop cannot make progress: zero verified candidates from five attempts today. */
export interface DocumentFreshnessBlockedAttentionItemV1 extends OperatingAttentionItemBaseV1 {
  kind: "document_freshness_blocked";
  state: "action_required";
  reasonCode: "zero_success_window";
  documentPath: string | null;
  attempts: number;
}

/**
 * An owner rule or correction captured from a terminal prompt or managed conversation (ADR-0466).
 * It waits for exact-hash review; `title` is the normalized rule title, never the owner's words.
 */
export interface DurableInstructionCandidateAttentionItemV1 extends OperatingAttentionItemBaseV1 {
  kind: "durable_instruction_candidate";
  state: "waiting_authority";
  candidateId: string;
  candidateHash: string;
  captureSource: "terminal_prompt" | "conversation" | "explicit_intake";
  title: string;
  targetPath: string;
}

/** A decision the owner stated, held until it is documented or dismissed (ADR-0466). */
export interface CapturedDecisionAttentionItemV1 extends OperatingAttentionItemBaseV1 {
  kind: "captured_decision";
  state: "action_required";
  captureId: string;
  captureSource: "terminal_prompt" | "conversation";
  title: string;
  capturedAt: string;
}

export type OperatingAttentionItemV1 =
  | WorkstreamDecisionAttentionItemV1
  | WorkstreamApprovalAttentionItemV1
  | WorkstreamBlockerAttentionItemV1
  | CanonicalizationAttentionItemV1
  | KnowledgeLifecycleAttentionItemV1
  | RepositoryReplicaDivergenceAttentionItemV1
  | DocumentFreshnessCandidateAttentionItemV1
  | DocumentFreshnessAppliedAttentionItemV1
  | DocumentFreshnessBlockedAttentionItemV1
  | DurableInstructionCandidateAttentionItemV1
  | CapturedDecisionAttentionItemV1;

export interface OperatingAttentionReportV1 {
  schemaVersion: 1;
  kind: "operating_attention.report";
  projectId: string;
  workstream: { workstreamId: string; revision: number } | null;
  observedAt: string;
  reportDigest: string;
  status: "current" | "action_required";
  coverage: {
    workstream: "current" | "missing";
    canonicalization: "complete" | "unavailable";
    knowledgeLifecycle: "complete" | "cached" | "unavailable";
  };
  summary: {
    totalCount: number;
    truncatedCount: number;
    blockingCount: number;
    userActionCount: number;
    staleCount: number;
  };
  items: OperatingAttentionItemV1[];
  limitations: string[];
}
