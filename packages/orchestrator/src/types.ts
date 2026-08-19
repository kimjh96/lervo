import type { InjectLoadedContextInput } from "@lervo/context-delivery";
import type { PrepareContextInput } from "@lervo/context";
import type { WriteContextDecision } from "@lervo/core";
import type {
  ManagedRunApprovalAuthorization,
  SharedContextPublication,
} from "@lervo/schemas";
import type { EventStoreTransaction } from "@lervo/storage-contract";

export interface ManagedEventStore {
  transact<T>(work: (transaction: EventStoreTransaction) => T): T;
}

export interface ManagedRunCoordinates {
  projectId: string;
  runId: string;
  sessionId: string;
  roleId: string;
}

export interface ManagedContextRunOptions {
  coordinates: ManagedRunCoordinates;
  policyVersion: string;
  events: ManagedEventStore;
  initialContextGeneration?: number;
  createEventId?: () => string;
  approvalVerifier?: ManagedCapabilityApprovalVerifier;
}

export interface ManagedCapabilityApprovalVerificationInput {
  authorization: ManagedRunApprovalAuthorization;
  projectId: string;
  runId: string;
  sessionId: string;
  roleId: string;
  provider: string;
  risk: string;
  requestDigest: string;
  verificationSuiteIds: string[];
  expectedPaths: string[];
  requestedPath: string | null;
  evaluatedAt: string;
}

export type ManagedCapabilityApprovalVerificationResult =
  | { approved: true; approvalId: string; policySnapshotId: string }
  | { approved: false; reasonCode: string };

export interface ManagedCapabilityApprovalVerifier {
  verify(
    input: ManagedCapabilityApprovalVerificationInput,
  ): Promise<ManagedCapabilityApprovalVerificationResult>;
}

export type ManagedContextPhase =
  | "awaiting_context"
  | "context_prepared"
  | "context_injected"
  | "write_authorized"
  | "telemetry_failed";

export interface ManagedContextSnapshot {
  phase: ManagedContextPhase;
  contextGeneration: number;
  telemetryHealthy: boolean;
  requiredDocumentIds: readonly string[];
}

export type ManagedPrepareContextInput = Omit<
  PrepareContextInput,
  "coordinates" | "policyVersion"
>;

export type ManagedInjectContextInput = Omit<
  InjectLoadedContextInput,
  | "repositoryRoot"
  | "loaded"
  | "contextGeneration"
  | "getCurrentContextGeneration"
  | "publications"
> & {
  publications: readonly SharedContextPublication[];
};

export interface FileWriteRequest {
  path: string;
  targetDigest: string;
  risk: string;
  publications: readonly SharedContextPublication[];
  occurredAt: Date;
  requestDigest?: string;
  verificationSuiteIds?: readonly string[];
  approvalAuthorization?: ManagedRunApprovalAuthorization;
}

export interface FileWritePermit {
  permitId: string;
  contextGeneration: number;
  path: string;
  targetDigest: string;
  expectedBeforeHash: string | null;
  authorizedAt: string;
  approvalId: string | null;
  policySnapshotId: string | null;
}

export type ManagedWriteDecision =
  | {
      allowed: true;
      assurance: "E3";
      missing: [];
      permit: FileWritePermit;
    }
  | {
      allowed: false;
      assurance: WriteContextDecision["assurance"];
      failure:
        | "required_context_missing"
        | "telemetry_recording_failed"
        | "capability_denied"
        | "approval_required";
      missing: Array<{
        documentId: string;
        reason: string;
      }>;
    };

export type ManagedContextInvalidationReason =
  | "managed_file_changed"
  | "file_change_unverified"
  | "context_compacted"
  | "session_restarted"
  | "snapshot_validation_failed";

export interface FileChangeRecord {
  permit: FileWritePermit;
  path: string;
  beforeHash: string | null;
  afterHash: string | null;
  changeKind: "created" | "modified" | "deleted";
  occurredAt: Date;
}

export type ManagedFileChangeEvidence = Pick<
  FileChangeRecord,
  "path" | "beforeHash" | "afterHash" | "changeKind"
>;

export type ManagedContextErrorCode =
  | "context_contract_invalid"
  | "invalid_state"
  | "file_snapshot_invalid"
  | "approval_verification_failed"
  | "telemetry_recording_failed"
  | "write_permit_invalid";

const failureByErrorCode = {
  context_contract_invalid: "contract_validation_failed",
  invalid_state: "contract_validation_failed",
  file_snapshot_invalid: "required_context_missing",
  approval_verification_failed: "approval_required",
  telemetry_recording_failed: "telemetry_recording_failed",
  write_permit_invalid: "required_context_missing",
} as const;

export class ManagedContextError extends Error {
  readonly failure: (typeof failureByErrorCode)[ManagedContextErrorCode];

  constructor(readonly code: ManagedContextErrorCode, message: string) {
    super(message);
    this.name = "ManagedContextError";
    this.failure = failureByErrorCode[code];
  }
}
