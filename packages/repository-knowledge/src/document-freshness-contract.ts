/**
 * Document freshness contract (ADR-0463): the finding the loop consumes, the candidate it
 * produces, the classes and states that decide authority, and the stable failure codes. Every
 * type here is data; decisions live in the neighbouring `document-freshness-*` modules.
 */

export type DocumentFreshnessReason =
  | "connected_path_changed"
  | "connected_path_deleted"
  | "reference_target_missing"
  | "review_interval_elapsed"
  | "managed_input_changed"
  | "superseded_by";

export type DocumentFreshnessPublicationGroup =
  "entrypoint" | "canonical" | "historical" | "generated" | "other";

export interface DocumentFreshnessPathChange {
  path: string;
  /** `sha256` of the Git object at the verified revision, or null when absent there. */
  beforeHash: string | null;
  /** `sha256` of the Git object at the current revision, or null when absent there. */
  afterHash: string | null;
  disposition: "modified" | "deleted" | "added" | "renamed";
  renamedTo: string | null;
}

export interface DocumentFreshnessReference {
  line: number;
  target: string;
  kind: "link" | "path_mention";
  symbol: string | null;
  resolved: boolean;
}

/** Where a finding came from: the ADR-0464 staleness projection or its drift lint codes. */
export type DocumentFreshnessFindingSource =
  "document_stale" | "entrypoint_reference_missing" | "markdown_link_target_missing";

export interface DocumentFreshnessFindingV1 {
  schemaVersion: 1;
  /** `sha256` of the canonical finding without `detectedAt`. */
  findingDigest: string;
  sources: DocumentFreshnessFindingSource[];
  documentPath: string;
  documentHash: string;
  verifiedRevision: string | null;
  currentRevision: string;
  reasons: DocumentFreshnessReason[];
  connectedPathChanges: DocumentFreshnessPathChange[];
  references: DocumentFreshnessReference[];
  publicationGroup: DocumentFreshnessPublicationGroup;
  supersededBy: string | null;
  detectedAt: string;
}

export type DocumentFreshnessPriorityClass = "safety" | "entrypoint" | "canonical" | "other";
export type DocumentFreshnessOperation =
  "edit" | "archive" | "no_change_needed" | "needs_owner_input";
export type DocumentFreshnessChangeClass = "factual_reference" | "statement" | "safety_or_policy";
export type DocumentFreshnessOwnership = "lervo_managed" | "user_owned";
export type DocumentFreshnessAuthority = "none" | "principal_mandate" | "owner";
export type DocumentFreshnessCrossCheck =
  "not_required" | "agreement" | "material_disagreement" | "unavailable";

/**
 * `verified_pending_cross_check` means every deterministic check passed but a consequential hunk
 * has no Tier 0 agreement because the cross-check was unavailable (ADR-0557); the owner reviews
 * instead. A candidate whose cross-check call has not settled yet stays `generated`.
 */
export type DocumentFreshnessCandidateState =
  | "generated"
  | "verified"
  | "verified_pending_cross_check"
  | "waiting_authority"
  | "applied"
  | "partially_applied"
  | "rejected"
  | "superseded"
  | "reverted";

export const documentFreshnessCheckCodes = [
  "source_hash",
  "outside_bytes_unchanged",
  "commonmark_structure",
  "references_resolve",
  "missing_references_resolved",
  "claims_bound",
  "edit_bound",
  "entrypoint_bounds",
  "writing_contract",
] as const;
export type DocumentFreshnessCheckCode = (typeof documentFreshnessCheckCodes)[number];

export interface DocumentFreshnessCheckResult {
  code: DocumentFreshnessCheckCode;
  status: "passed" | "failed";
  detail: string;
}

export const documentFreshnessFailureCodes = [
  "claim_unbound",
  "reference_unresolved",
  "outside_bytes_changed",
  "cross_check_disagreement",
  "source_changed",
  "freshness_budget_exhausted",
  "revert_conflict",
  "freshness_hold_active",
  "candidate_invalid",
  "owner_rejected",
  "write_failed",
] as const;
export type DocumentFreshnessFailureCode = (typeof documentFreshnessFailureCodes)[number];

export interface DocumentFreshnessEvidenceCitation {
  path: string;
  hash: string;
  lineRange: [number, number] | null;
}

export interface DocumentFreshnessClaim {
  claimDigest: string;
  text: string;
  evidence: DocumentFreshnessEvidenceCitation[];
}

export interface DocumentFreshnessHunk {
  hunkId: string;
  range: { startByte: number; endByte: number };
  beforeHash: string;
  replacement: string;
  changeClass: DocumentFreshnessChangeClass;
  ownership: DocumentFreshnessOwnership;
  /** The `lervo_v1` block holding the range, when the hunk is inside one. */
  managedBlockId: string | null;
  authorityRequired: DocumentFreshnessAuthority;
  /** True when the hunk needs a Tier 0 cross-check before any authority may apply it. */
  crossCheckRequired: boolean;
  claims: DocumentFreshnessClaim[];
}

export interface DocumentFreshnessLinkRewrite {
  path: string;
  line: number;
  from: string;
  to: string;
}

export interface DocumentFreshnessArchivePlan {
  targetPath: string;
  banner: string;
  /** Links in other documents that pointed at the archived document. */
  inboundLinkRewrites: DocumentFreshnessLinkRewrite[];
  /** The archived document's own relative links, kept resolving after the move. */
  outgoingLinkRewrites: DocumentFreshnessLinkRewrite[];
  ownership: DocumentFreshnessOwnership;
  /** Content hash of every other document the archive rewrites, bound at verification. */
  inboundSourceHashes: Record<string, string>;
}

export interface DocumentFreshnessRejection {
  reasonCode: DocumentFreshnessFailureCode;
  rejectorKind: "deterministic" | "cross_check" | "proxy" | "owner" | "budget";
  contestedHunkIds: string[];
}

export interface DocumentFreshnessApproval {
  approvalSource: "lervo_managed" | "principal_mandate" | "owner";
  approvalRef: string;
  reviewer: string | null;
  approvedAt: string;
}

/** One reviewer verdict for one hunk; `reason` is short reviewer prose kept only in the store. */
export interface DocumentFreshnessCrossCheckVerdict {
  hunkId: string;
  verdict: "agree" | "disagree";
  reason: string;
}

/**
 * Why a required cross-check has no outcome. Every value holds the candidate for the owner; none
 * is ever read as agreement.
 */
export type DocumentFreshnessCrossCheckUnavailableReason =
  | "archive_not_cross_checked"
  | "freshness_budget_exhausted"
  | "knowledge_authority_unavailable"
  | "knowledge_capacity_unavailable"
  | "knowledge_provider_paused"
  | "provider_not_admitted"
  | "cross_check_input_unavailable"
  | "cross_check_provider_failed"
  | "cross_check_usage_unavailable"
  | "cross_check_response_invalid";

/**
 * The ADR-0557 Tier 0 record on a candidate. `pending` means the input is in CAS and the call has
 * not settled; `settled` carries the outcome. `runId` is the cross-check call's ADR-0459 run and
 * the `deliberationRunId` of the `verified` event. Prompts and inputs never leave CAS.
 */
export interface DocumentFreshnessCrossCheckReview {
  status: "pending" | "settled";
  inputHash: string | null;
  runId: string | null;
  reviewerProvider: "codex" | "claude" | null;
  outcome: DocumentFreshnessCrossCheck | null;
  unavailableReason: DocumentFreshnessCrossCheckUnavailableReason | null;
  verdicts: DocumentFreshnessCrossCheckVerdict[];
  tokensObserved: number;
  deferrals: number;
  settledAt: string | null;
}

export interface DocumentFreshnessCandidateV1 {
  schemaVersion: 1;
  candidateId: string;
  /** Correlates the provider call's ADR-0459 usage record (`turnEventId`). */
  generationId: string;
  findingDigest: string;
  bundleHash: string;
  /** Additive reader contract. Legacy candidates have no complete dependency witness. */
  dependencyWitness?: import("./document-freshness-assessment.js").DocumentFreshnessDependencyWitness;
  assessmentReceiptHash?: string;
  predecessorCandidateId?: string;
  documentPath: string;
  sourceHash: string;
  priorityClass: DocumentFreshnessPriorityClass;
  operation: DocumentFreshnessOperation;
  hunks: DocumentFreshnessHunk[];
  archive: DocumentFreshnessArchivePlan | null;
  /** Bounded to 1 KiB; only for `no_change_needed` and `needs_owner_input`. */
  explanation: string | null;
  reasonsAddressed: DocumentFreshnessReason[];
  authorityRequired: DocumentFreshnessAuthority;
  state: DocumentFreshnessCandidateState;
  checks: DocumentFreshnessCheckResult[];
  crossCheck: DocumentFreshnessCrossCheck;
  /** Additive: absent on candidates created before Tier 0 existed. */
  crossCheckReview?: DocumentFreshnessCrossCheckReview;
  evidenceCount: number;
  evidenceTruncated: boolean;
  /** CAS reference of the exact source bytes, written before any apply. */
  beforeBytesRef: string | null;
  /** Hash of the full verified output with every hunk applied. */
  afterHash: string | null;
  /** Hash of the document after the latest apply; null until something was applied. */
  appliedHash: string | null;
  appliedHunkIds: string[];
  pendingHunkIds: string[];
  tokensObserved: number;
  rejection: DocumentFreshnessRejection | null;
  approval: DocumentFreshnessApproval | null;
  commitHash: string | null;
  acknowledgedAt: string | null;
  detectedAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface DocumentFreshnessHold {
  schemaVersion: 1;
  findingDigest: string;
  documentPath: string;
  candidateId: string;
  reason: "reverted" | "not_stale";
  until: string;
}

export interface DocumentFreshnessPolicy {
  enabled: boolean;
  safetyPatterns: string[];
  maximumCandidatesPerCycle: number;
  maximumTokensPerCandidate: number;
  maximumTokensPerDay: number;
  maximumEditRatio: number;
  maximumEditBytes: number;
  historicalRoot: string;
  holdDays: number;
  crossCheck: "required_for_consequential" | "always" | "never";
}

export const defaultDocumentFreshnessPolicy: DocumentFreshnessPolicy = {
  enabled: true,
  safetyPatterns: [
    "risk",
    "limit",
    "leverage",
    "loss",
    "credential",
    "secret",
    "deploy",
    "production",
    "live",
  ],
  maximumCandidatesPerCycle: 3,
  maximumTokensPerCandidate: 30_000,
  maximumTokensPerDay: 150_000,
  maximumEditRatio: 0.25,
  maximumEditBytes: 4_096,
  historicalRoot: "docs/archive",
  holdDays: 7,
  crossCheck: "required_for_consequential",
};

export const DOCUMENT_FRESHNESS_EXPLANATION_BYTES = 1_024;
export const documentFreshnessCandidateIdPattern = /^kfresh_[a-f0-9]{24}$/u;
