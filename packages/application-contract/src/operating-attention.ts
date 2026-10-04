export type OperatingAttentionActionOwnerV1 = "agent" | "reviewer" | "user" | "unassigned";

interface OperatingAttentionItemBaseV1 {
  schemaVersion: 1;
  itemId: string;
  actionOwner: OperatingAttentionActionOwnerV1;
  requiresUserAction: boolean;
  blocking: boolean;
  instruction: string;
}

export interface WorkstreamDecisionAttentionItemV1 extends OperatingAttentionItemBaseV1 {
  kind: "workstream_decision";
  state: "pending";
  decisionId: string;
  question: string;
  choices: Array<{ choiceId: string; label: string; consequence: string }>;
  recommendedChoiceId: string | null;
}

export interface WorkstreamApprovalAttentionItemV1 extends OperatingAttentionItemBaseV1 {
  kind: "workstream_approval";
  state: "pending";
  approvalId: string;
  approvalKind: "repository_bytes" | "managed_write" | "external_action" | "deployment";
  summary: string;
  bindingHash: string;
}

export interface WorkstreamBlockerAttentionItemV1 extends OperatingAttentionItemBaseV1 {
  kind: "workstream_blocker";
  state: "blocked";
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

export type OperatingAttentionItemV1 =
  | WorkstreamDecisionAttentionItemV1
  | WorkstreamApprovalAttentionItemV1
  | WorkstreamBlockerAttentionItemV1
  | CanonicalizationAttentionItemV1
  | KnowledgeLifecycleAttentionItemV1
  | RepositoryReplicaDivergenceAttentionItemV1;

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
