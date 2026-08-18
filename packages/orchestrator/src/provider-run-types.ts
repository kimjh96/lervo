import type { ProviderAdapter } from "@roven/adapter-contract";
import type { ContextArtifactPort, ResolvedWritingPolicy } from "@roven/context-delivery";
import type { AdapterSession, AdapterTurn } from "@roven/schemas";

import type { ManagedProviderRunDeadlines } from "./provider-run-deadline.js";
import type { ManagedProviderRunPhase } from "./provider-run-phase.js";
import type {
  ManagedContextRunOptions,
  ManagedFileChangeEvidence,
  ManagedPrepareContextInput,
} from "./types.js";
import type {
  CaptureRepositorySnapshot,
  RepositorySnapshotPolicy,
} from "./repository-snapshot.js";

export type ManagedProviderRunFailureCode =
  | "cancelled"
  | "artifact_storage_failed"
  | "context_injection_failed"
  | "context_preparation_failed"
  | "contract_validation_failed"
  | "provider_start_failed"
  | "provider_stop_failed"
  | "provider_stream_failed"
  | "provider_turn_failed"
  | "provider_write_failed"
  | "provider_result_failed"
  | "repository_snapshot_failed"
  | "telemetry_recording_failed"
  | "unmanaged_change_detected";

export class ManagedProviderRunError extends Error {
  readonly paths: readonly string[];
  readonly relatedFailures: ReadonlyArray<{
    code: ManagedProviderRunFailureCode;
    phase: ManagedProviderRunPhase;
    retryable: boolean;
  }>;
  readonly originPhase: ManagedProviderRunPhase | undefined;

  constructor(
    readonly code: ManagedProviderRunFailureCode,
    message: string,
    options?: ErrorOptions & {
      paths?: readonly string[];
      relatedFailures?: ReadonlyArray<{
        code: ManagedProviderRunFailureCode;
        phase: ManagedProviderRunPhase;
        retryable: boolean;
      }>;
      originPhase?: ManagedProviderRunPhase;
    },
  ) {
    super(message, options);
    this.name = "ManagedProviderRunError";
    this.paths = options?.paths === undefined ? [] : [...options.paths];
    this.relatedFailures = options?.relatedFailures === undefined
      ? []
      : structuredClone(options.relatedFailures);
    this.originPhase = options?.originPhase;
  }
}

export interface ManagedProviderRunOptions extends ManagedContextRunOptions {
  adapter: ProviderAdapter;
  artifactStore: ContextArtifactPort;
  captureSnapshot?: CaptureRepositorySnapshot;
  snapshotPolicy?: RepositorySnapshotPolicy;
  deadlines?: Partial<ManagedProviderRunDeadlines>;
  now?: () => Date;
}

export interface ManagedProviderRunInput {
  repositoryRoot: string;
  requestDigest: string;
  risk: string;
  instructions: string;
  targetTurnId: string;
  context: Omit<
    ManagedPrepareContextInput,
    "repositoryRoot" | "sourceRevision" | "recordedAt"
  >;
  writingPolicy: ResolvedWritingPolicy | null;
  resolvedSkills: readonly ManagedResolvedSkill[];
  signal?: AbortSignal;
  createEnvelopeId?: () => string;
  createEvidenceReceiptId?: () => string;
}

export interface ManagedResolvedSkill {
  skillId: string;
  version: string;
  contentHash: string;
  sourceKind: "project" | "user";
  trustStatus: "untrusted" | "reviewed" | "verified";
}

export interface ManagedProviderRunResult {
  status: "completed";
  session: AdapterSession;
  turn: AdapterTurn;
  terminalEventId: string;
  resultArtifact: ManagedProviderResultArtifact;
  managedChanges: ManagedFileChangeEvidence[];
  contextGeneration: number;
  beforeRevision: string;
  afterRevision: string;
}

export interface ManagedProviderResultArtifact {
  artifactId: string;
  uri: string;
  mediaType: "text/markdown; charset=utf-8";
  contentHash: string;
  byteCount: number;
}
