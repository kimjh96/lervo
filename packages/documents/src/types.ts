import type {
  DocumentMigrationAppliedEventPayload,
  DocumentMigrationApproval,
  DocumentMigrationApplyReceipt,
  DocumentMigrationCandidate,
  DocumentMigrationCandidateArtifact,
  DocumentMigrationPlan,
  LegacyRegistryEntryArtifact,
  LegacyRegistryMigrationPlan,
} from "@lervo/schemas";

export interface DocumentScanLimits {
  maximumFiles: number;
  maximumFileBytes: number;
  maximumTotalBytes: number;
}

export interface ScannedDocumentSource {
  path: string;
  contentHash: string;
  byteCount: number;
  bytes: Uint8Array;
}

export interface DocumentImportSource {
  path: string;
  contentHash: string;
  byteCount: number;
  bytes: Uint8Array;
}

export type CandidateDisposition = DocumentMigrationCandidate["disposition"];
export type CandidateConfidence = DocumentMigrationCandidate["confidence"];
export type DetectedDocumentOwnership = DocumentMigrationCandidate["detectedOwnership"];

export interface DocumentImportDraft {
  formatId: string;
  locator?: string;
  disposition: CandidateDisposition;
  confidence: CandidateConfidence;
  detectedOwnership: DetectedDocumentOwnership;
  proposal: null | {
    documentId: string;
    documentPath: string;
    profileId: string;
    relations: {
      supersedesDocumentIds: readonly string[];
      relatedDocumentIds: readonly string[];
    };
  };
  warnings: readonly string[];
}

export interface DocumentImportAdapter {
  readonly descriptor: {
    readonly adapterId: string;
    readonly version: string;
  };
  supports(path: string): boolean;
  inspect(source: DocumentImportSource):
    | readonly DocumentImportDraft[]
    | Promise<readonly DocumentImportDraft[]>;
}

export interface DocumentMigrationDryRun {
  plan: DocumentMigrationPlan;
  candidateArtifacts: readonly DocumentMigrationCandidateArtifact[];
  candidateArtifactBytes: ReadonlyMap<string, Uint8Array>;
}

export interface LegacyRegistryMigrationDryRun {
  plan: LegacyRegistryMigrationPlan;
  entryArtifacts: readonly LegacyRegistryEntryArtifact[];
  entryArtifactBytes: ReadonlyMap<string, Uint8Array>;
}

export interface DocumentMigrationAppliedEvent {
  type: "document.migration.applied";
  payload: DocumentMigrationAppliedEventPayload;
}

export interface DurableDocumentMigrationEventRecorder {
  record(event: DocumentMigrationAppliedEvent): void | Promise<void>;
}

export interface ApplyDocumentMigrationInput {
  repositoryRoot: string;
  plan: DocumentMigrationPlan;
  candidateArtifacts: readonly DocumentMigrationCandidateArtifact[];
  approval: DocumentMigrationApproval;
  eventRecorder: DurableDocumentMigrationEventRecorder;
  appliedAt?: string;
}

export type ApplyDocumentMigrationResult = DocumentMigrationApplyReceipt;

export type DocumentMigrationErrorCode =
  | "ambiguous_import_adapter"
  | "invalid_adapter_contract"
  | "invalid_generated_at"
  | "invalid_legacy_registry"
  | "invalid_approval"
  | "invalid_migration_artifact"
  | "invalid_scan_request"
  | "scan_limit_exceeded"
  | "migration_apply_failed"
  | "migration_conflict"
  | "migration_finalization_failed"
  | "plan_stale"
  | "rollback_failed"
  | "telemetry_recording_failed"
  | "unsafe_source";

export class DocumentMigrationError extends Error {
  constructor(
    readonly code: DocumentMigrationErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "DocumentMigrationError";
  }
}
