import type { ManagedProviderRunResult } from "@lervo/orchestrator";
import type {
  DeliberationArtifact,
  DeliberationArtifactKind,
  DeliberationOutcome,
  DeliberationPolicy,
  EventEnvelope,
  HandoffBundle,
  SharedContextPublication,
  WritingContract,
} from "@lervo/schemas";
import type { ArtifactStore, EventStore } from "@lervo/storage-contract";
import type { WritingSemanticEvaluator } from "@lervo/writing";
import type { DeliberationVerificationEvidence } from "@lervo/deliberation";

export type DeliberationArtifactDetails<K extends DeliberationArtifactKind> =
  Extract<DeliberationArtifact, { kind: K }>["details"];

export type DeliberationRuntimeErrorCode =
  | "artifact_publication_failed"
  | "context_evidence_invalid"
  | "event_recording_failed"
  | "runtime_state_invalid";

export type DeliberationRuntimeErrorReason =
  | "artifact_history_invalid"
  | "artifact_already_published"
  | "event_redacted"
  | "event_store_failed"
  | "managed_run_coordinate_mismatch"
  | "managed_run_event_missing"
  | "operation_in_progress"
  | "previous_artifact_not_loaded"
  | "provider_session_reused"
  | "publication_artifact_mismatch"
  | "publication_handoff_invalid"
  | "receipt_event_mismatch"
  | "runtime_already_completed"
  | "runtime_not_started"
  | "runtime_started_twice"
  | "shared_context_invalid"
  | "writing_policy_mismatch"
  | "writing_publication_blocked";

export class DeliberationRuntimeError extends Error {
  constructor(
    readonly code: DeliberationRuntimeErrorCode,
    readonly reason: DeliberationRuntimeErrorReason,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "DeliberationRuntimeError";
  }
}

export interface DeliberationRuntimeCoordinates {
  projectId: string;
  runId: string;
  sessionId: string;
}

export interface DeliberationRuntimeOptions {
  deliberationId: string;
  policy: DeliberationPolicy;
  policyVersion: string;
  coordinates: DeliberationRuntimeCoordinates;
  events: EventStore;
  artifactStore: ArtifactStore;
  now?: () => Date;
  createEventId?: () => string;
}

export interface ExecuteDeliberationTurnInput<K extends DeliberationArtifactKind> {
  kind: K;
  round: number;
  details: DeliberationArtifactDetails<K>;
  previousArtifactIds: readonly string[];
  sharedContextPublications: readonly SharedContextPublication[];
  executeManagedRun(): Promise<ManagedProviderRunResult>;
  writingContract: WritingContract;
  semanticEvaluator: WritingSemanticEvaluator;
  verificationEvidence?: DeliberationVerificationEvidence;
}

export interface DeliberationTurnResult {
  artifact: DeliberationArtifact;
  content: string;
  recordedEvent: EventEnvelope;
}

export interface DeliberationRuntimeResult {
  outcome: DeliberationOutcome;
  completedEvent: EventEnvelope;
}

export interface PublishDeliberationHandoffInput {
  artifactId: string;
  publication: SharedContextPublication;
  handoff: HandoffBundle;
}

export interface PublishedDeliberationHandoff {
  publication: SharedContextPublication;
  handoff: HandoffBundle;
  publishedEvent: EventEnvelope;
  handoffEvent: EventEnvelope;
}
