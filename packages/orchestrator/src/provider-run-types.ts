import type { ProviderAdapter } from "@lervo/adapter-contract";
import type { ContextArtifactPort, ResolvedWritingPolicy } from "@lervo/context-delivery";
import type {
  ManagedProjectVerification,
  ManagedProviderRunResult,
} from "@lervo/execution-contract";
import type {
  ManagedRunApprovalAuthorization,
  VerificationSuite,
} from "@lervo/schemas";

import type { ManagedProviderRunDeadlines } from "./provider-run-deadline.js";
import type { ManagedProviderRunPhase } from "./provider-run-phase.js";
import type {
  ManagedContextRunOptions,
  ManagedPrepareContextInput,
} from "./types.js";
import type {
  CaptureRepositorySnapshot,
  RepositorySnapshotPolicy,
} from "./repository-snapshot.js";

export type {
  ManagedProjectVerification,
  ManagedProviderResultArtifact,
  ManagedProviderRunResult,
  ManagedVerificationResultArtifact,
} from "@lervo/execution-contract";

export type ManagedProviderRunFailureCode =
  | "cancelled"
  | "approval_required"
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
  | "verification_failed"
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
  maximumProviderSignals?: number;
  now?: () => Date;
  projectVerifier?: ManagedProjectVerifier;
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
  verificationSuites?: readonly VerificationSuite[];
  signal?: AbortSignal;
  createEnvelopeId?: () => string;
  createEvidenceReceiptId?: () => string;
  createTargetTurnId?: () => string;
  approvalAuthorization?: ManagedRunApprovalAuthorization;
}

export interface ManagedResolvedSkill {
  skillId: string;
  version: string;
  contentHash: string;
  sourceKind: "project" | "user";
  trustStatus: "untrusted" | "reviewed" | "verified";
}

export interface ManagedProjectVerifier {
  verify(input: {
    suite: VerificationSuite;
    repositoryRoot: string;
    repositoryRevision: string;
    signal?: AbortSignal;
  }): Promise<ManagedProjectVerification>;
}
