import type { DeliberationVerificationEvidence } from "@lervo/deliberation";
import type {
  DeliberationArtifact,
  DeliberationOutcome,
  DeliberationPolicy,
  EventEnvelope,
  KnowledgeCandidate,
} from "@lervo/schemas";
import type { ArtifactStore, EventStore } from "@lervo/storage-contract";

export type KnowledgeErrorCode =
  | "artifact_storage_failed"
  | "candidate_contract_invalid"
  | "candidate_evidence_invalid"
  | "candidate_not_eligible"
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

export class KnowledgeError extends Error {
  constructor(
    readonly code: KnowledgeErrorCode,
    readonly reason: KnowledgeErrorReason,
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
