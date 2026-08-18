import type { ProviderAdapter } from "@roven/adapter-contract";
import type { ContextArtifactPort, ResolvedWritingPolicy } from "@roven/context-delivery";
import type { AdapterSession, AdapterTurn } from "@roven/schemas";

import type { ManagedContextRunOptions, ManagedPrepareContextInput } from "./types.js";
import type {
  CaptureRepositorySnapshot,
  RepositorySnapshot,
} from "./repository-snapshot.js";

export type ManagedProviderRunFailureCode =
  | "cancelled"
  | "context_injection_failed"
  | "context_preparation_failed"
  | "contract_validation_failed"
  | "provider_start_failed"
  | "provider_stop_failed"
  | "provider_stream_failed"
  | "provider_turn_failed"
  | "repository_snapshot_failed"
  | "telemetry_recording_failed"
  | "unmanaged_change_detected";

export class ManagedProviderRunError extends Error {
  readonly paths: readonly string[];

  constructor(
    readonly code: ManagedProviderRunFailureCode,
    message: string,
    options?: ErrorOptions & { paths?: readonly string[] },
  ) {
    super(message, options);
    this.name = "ManagedProviderRunError";
    this.paths = options?.paths === undefined ? [] : [...options.paths];
  }
}

export interface ManagedProviderRunOptions extends ManagedContextRunOptions {
  adapter: ProviderAdapter;
  artifactStore?: ContextArtifactPort;
  captureSnapshot?: CaptureRepositorySnapshot;
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
  signal?: AbortSignal;
  createEnvelopeId?: () => string;
  createEvidenceReceiptId?: () => string;
}

export interface ManagedProviderRunResult {
  status: "completed";
  session: AdapterSession;
  turn: AdapterTurn;
  terminalEventId: string;
  contextGeneration: number;
  beforeRevision: string;
  afterRevision: string;
  unmanagedPaths: [];
}

export interface ManagedProviderRunExecutionState {
  session?: AdapterSession;
  turn?: AdapterTurn;
  before?: RepositorySnapshot;
  after?: RepositorySnapshot;
}
