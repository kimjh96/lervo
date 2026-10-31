export type OperatingAttentionActionOwnerV1 = "agent" | "reviewer" | "user" | "unassigned";

interface OperatingAttentionItemBaseV1 {
  schemaVersion: 1;
  itemId: string;
  actionOwner: OperatingAttentionActionOwnerV1;
  requiresUserAction: boolean;
  blocking: boolean;
  instruction: string;
  /** Original source guidance retained for inspection when ownership is reframed. */
  recordedInstruction?: string;
  /** Additive ADR-0535 attribution; absent on older readers and fixtures. */
  attribution?: import("./repository-health.js").RepositoryHealthAttentionV1;
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
  ownerConsequence?: "repository_write" | "security_policy" | null;
  createdAt?: string;
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
 * An owner rule or correction captured from a terminal prompt or managed conversation (ADR-0467).
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
  createdAt?: string;
}

/** A decision the owner stated, held until it is documented or dismissed (ADR-0467). */
export interface CapturedDecisionAttentionItemV1 extends OperatingAttentionItemBaseV1 {
  kind: "captured_decision";
  state: "action_required";
  captureId: string;
  captureSource: "terminal_prompt" | "conversation";
  title: string;
  capturedAt: string;
}

/**
 * ADR-0467: owner turns are queued on this host, but it has no background-work authority (no
 * active delegation for its provider), so it cannot assess them. One item per host.
 */
export interface InstructionCaptureBlockedAttentionItemV1 extends OperatingAttentionItemBaseV1 {
  kind: "instruction_capture_blocked";
  state: "action_required";
  reasonCode: "knowledge_authority_unavailable";
  queuedCount: number;
  since: string;
}

/**
 * ADR-0466: this host cannot prove it owns knowledge convergence, or a standalone host saw
 * another host's fresh knowledge commit. Convergence stays read-only until it is resolved.
 */
export interface KnowledgeConvergenceOwnerAttentionItemV1 extends OperatingAttentionItemBaseV1 {
  kind: "knowledge_convergence_owner";
  state: "action_required";
  role: "unverifiable" | "contended";
  reason: string;
  /** The recorded Hub failure cause of an `unverifiable` verdict, such as `hub_forbidden`. */
  failureCode: string | null;
  /** The Hub's HTTP status for `failureCode`, when it answered with one. */
  httpStatus: number | null;
  holderLabel: string | null;
  observedAt: string;
}

/** ADR-0466: publishing the owner's knowledge commits failed; one item per failure code. */
export interface KnowledgePublicationAttentionItemV1 extends OperatingAttentionItemBaseV1 {
  kind: "knowledge_publication";
  state: "action_required";
  failureCode: string;
  detail: string | null;
  pullRequestUrl: string | null;
  occurrences: number;
  firstObservedAt: string;
}

/**
 * ADR-0469: a background knowledge continuity gap on this host, such as a delegation that will
 * lapse without a policy, a Hub that refuses coordination, or a checkout no resident reconciles.
 * It never blocks; it requires the user only for an authority or scope decision.
 */
export interface KnowledgeConvergenceContinuityAttentionItemV1 extends OperatingAttentionItemBaseV1 {
  kind: "knowledge_convergence_continuity";
  state: "action_required" | "observed";
  findingCode: string;
  severity: "attention" | "owner_decision";
  /** A closed cause code or a host label; never a path, URL, or message. */
  detail: string | null;
  observedAt: string | null;
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
  | CapturedDecisionAttentionItemV1
  | InstructionCaptureBlockedAttentionItemV1
  | KnowledgeConvergenceOwnerAttentionItemV1
  | KnowledgePublicationAttentionItemV1
  | KnowledgeConvergenceContinuityAttentionItemV1;

export interface OperatingAttentionReportV1 {
  schemaVersion: 1;
  kind: "operating_attention.report";
  projectId: string;
  workstream: { workstreamId: string; revision: number } | null;
  observedAt: string;
  reportDigest: string;
  status: "current" | "action_required";
  coverage: {
    workstream: "current" | "missing" | "unavailable";
    canonicalization: "complete" | "unavailable";
    knowledgeLifecycle: "complete" | "cached" | "unavailable";
    documentFreshness?: "complete" | "unavailable";
    instructionCapture?: "complete" | "unavailable";
    knowledgeConvergence?: "complete" | "unavailable";
  };
  summary: {
    totalCount: number;
    truncatedCount: number;
    blockingCount: number;
    userActionCount: number;
    staleCount: number;
    /** Full authority classification before the 256-item return cap. */
    byKind?: Record<string, { totalCount: number; userActionCount: number }>;
  };
  items: OperatingAttentionItemV1[];
  limitations: string[];
  /** Same private projection consumed by compact terminal turns; never computed by a hook. */
  health?: import("./repository-health.js").RepositoryHealthProjectionV1;
}
