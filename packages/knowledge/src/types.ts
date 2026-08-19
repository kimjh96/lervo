import type { DeliberationVerificationEvidence } from "@lervo/deliberation";
import type {
  DeliberationArtifact,
  DeliberationOutcome,
  DeliberationPolicy,
  EventEnvelope,
  KnowledgeCandidate,
  KnowledgePromotionPolicy,
  KnowledgeReviewApproval,
  KnowledgeStalenessResult,
  VerifiedKnowledge,
} from "@lervo/schemas";
import type { ArtifactStore, EventStore } from "@lervo/storage-contract";

export type KnowledgeErrorCode =
  | "artifact_storage_failed"
  | "candidate_contract_invalid"
  | "candidate_evidence_invalid"
  | "candidate_not_eligible"
  | "review_contract_invalid"
  | "promotion_not_eligible"
  | "staleness_contract_invalid"
  | "event_recording_failed";

export type KnowledgeErrorReason =
  | "candidate_already_recorded"
  | "candidate_artifact_mismatch"
  | "candidate_schema_invalid"
  | "claim_path_missing"
  | "decision_artifact_missing"
  | "decision_content_unavailable"
  | "evidence_event_missing"
  | "event_store_failed"
  | "outcome_event_mismatch"
  | "outcome_not_converged"
  | "verification_evidence_missing"
  | "verification_revision_mismatch";

export type KnowledgeLifecycleErrorReason =
  | "approval_already_recorded"
  | "approval_artifact_mismatch"
  | "approval_not_approved"
  | "approval_schema_invalid"
  | "candidate_event_missing"
  | "conflicts_unresolved"
  | "knowledge_already_recorded"
  | "knowledge_artifact_mismatch"
  | "knowledge_schema_invalid"
  | "linked_path_missing"
  | "policy_schema_invalid"
  | "repository_revision_mismatch"
  | "review_event_missing"
  | "reviewer_not_allowed"
  | "staleness_artifact_mismatch"
  | "staleness_not_stale"
  | "staleness_schema_invalid";

export class KnowledgeError extends Error {
  constructor(
    readonly code: KnowledgeErrorCode,
    readonly reason: KnowledgeErrorReason | KnowledgeLifecycleErrorReason,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "KnowledgeError";
  }
}

export interface CreateKnowledgeCandidatesInput {
  deliberationId: string;
  policy: DeliberationPolicy;
  artifacts: readonly DeliberationArtifact[];
  verificationEvidence: readonly DeliberationVerificationEvidence[];
  outcome: DeliberationOutcome;
  outcomeEvent: EventEnvelope;
  pathsByClaimId: Readonly<Record<string, readonly string[]>>;
  reviewIntervalDays: number;
  conflictCandidateIdsByClaimId?: Readonly<Record<string, readonly string[]>>;
  policyVersion: string;
  events: EventStore;
  artifactStore: ArtifactStore;
  createEventId: () => string;
}

export interface KnowledgeCandidateArtifact {
  artifactId: string;
  uri: string;
  mediaType: "application/vnd.lervo.knowledge-candidate+json; charset=utf-8";
  contentHash: string;
  byteCount: number;
}

export interface CreatedKnowledgeCandidate {
  candidate: KnowledgeCandidate;
  candidateArtifact: KnowledgeCandidateArtifact;
  recordedEvent: EventEnvelope;
}

export interface KnowledgeRepositorySnapshot {
  revision: string;
  files: Readonly<Record<string, string>>;
}

export interface KnowledgeArtifactCoordinate {
  artifactId: string;
  uri: string;
  contentHash: string;
  byteCount: number;
}

export interface ReviewKnowledgeCandidateInput {
  candidate: KnowledgeCandidate;
  candidateArtifact: KnowledgeCandidateArtifact;
  policy: KnowledgePromotionPolicy;
  reviewerId: string;
  decision: "approved" | "rejected";
  resolvedConflictCandidateIds: readonly string[];
  repositoryRevision: string;
  reviewedAt: string;
  runId: string;
  sessionId: string;
  events: EventStore;
  artifactStore: ArtifactStore;
  createEventId: () => string;
}

export interface ReviewedKnowledgeCandidate {
  approval: KnowledgeReviewApproval;
  approvalArtifact: KnowledgeArtifactCoordinate;
  recordedEvent: EventEnvelope;
}

export interface PromoteKnowledgeCandidateInput {
  candidate: KnowledgeCandidate;
  candidateArtifact: KnowledgeCandidateArtifact;
  review: ReviewedKnowledgeCandidate;
  policy: KnowledgePromotionPolicy;
  currentSnapshot: KnowledgeRepositorySnapshot;
  policyVersion: string;
  events: EventStore;
  artifactStore: ArtifactStore;
  createEventId: () => string;
}

export interface PromotedKnowledge {
  knowledge: VerifiedKnowledge;
  knowledgeArtifact: KnowledgeArtifactCoordinate;
  recordedEvent: EventEnvelope;
}

export interface EvaluateKnowledgeStalenessInput {
  knowledge: VerifiedKnowledge;
  evaluatedAt: string;
  currentSnapshot: KnowledgeRepositorySnapshot;
}

export interface RecordKnowledgeStalenessInput {
  knowledge: VerifiedKnowledge;
  knowledgeArtifact: KnowledgeArtifactCoordinate;
  result: KnowledgeStalenessResult;
  runId: string;
  sessionId: string;
  policyVersion: string;
  events: EventStore;
  artifactStore: ArtifactStore;
  createEventId: () => string;
}

export interface RecordedKnowledgeStaleness {
  result: KnowledgeStalenessResult;
  resultArtifact: KnowledgeArtifactCoordinate;
  recordedEvent: EventEnvelope;
}
