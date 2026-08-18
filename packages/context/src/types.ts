import type {
  ContextEvidence,
  ContextScope,
  DocumentRegistry,
  HandoffBundle,
  RoleProfile,
  SelectionReasonCode,
  SharedContextPublication,
} from "@roven/schemas";

export interface ContextRunCoordinates {
  projectId: string;
  runId: string;
  sessionId: string;
  roleId: string;
}

export interface ContextDocumentCandidate {
  documentId: string;
  path: string;
  connectedPaths: readonly string[];
  source: "instruction" | "registry";
}

export interface ContextSelectionReason {
  reasonCode: SelectionReasonCode;
  ruleId: string;
}

export interface PlannedContextDocument {
  documentId: string;
  path: string;
  required: true;
  scope: ContextScope;
  reasons: ContextSelectionReason[];
  sharedContextIds: string[];
  expectedContentHash?: string;
}

export interface ContextPlan {
  coordinates: ContextRunCoordinates;
  documents: PlannedContextDocument[];
  evidence: ContextEvidence[];
  createdAt: string;
}

export interface ContextHandoffInput {
  bundle: HandoffBundle;
  producerRole: RoleProfile;
}

export type DocumentRuleMap = Readonly<Record<string, readonly string[]>>;

export interface CreateContextPlanInput {
  coordinates: ContextRunCoordinates;
  registry: DocumentRegistry;
  role: RoleProfile;
  expectedPaths: readonly string[];
  documentRules: DocumentRuleMap;
  instructionDocuments: readonly ContextDocumentCandidate[];
  publications: readonly SharedContextPublication[];
  handoffs: readonly ContextHandoffInput[];
  policyVersion: string;
  recordedAt: Date;
  createReceiptId?: () => string;
}

export interface LoadedContextDocument extends PlannedContextDocument {
  bytes: Uint8Array;
  contentHash: string;
  byteCount: number;
  sourceRevision: string;
}

export interface LoadedContext {
  plan: ContextPlan;
  documents: LoadedContextDocument[];
  evidence: ContextEvidence[];
  loadedAt: string;
}

export interface PrepareContextInput
  extends Omit<CreateContextPlanInput, "instructionDocuments"> {
  repositoryRoot: string;
  sourceRevision: string;
}

export type ContextInvalidationReason =
  | "content_changed"
  | "document_missing"
  | "publication_document_changed"
  | "document_unsafe"
  | "publication_access_revoked"
  | "publication_content_changed"
  | "publication_expired"
  | "publication_missing"
  | "publication_not_yet_published"
  | "publication_superseded";

export interface ContextInvalidation {
  documentId: string;
  reason: ContextInvalidationReason;
  sharedContextId?: string;
  previousContentHash?: string;
  currentContentHash?: string;
}

export type ContextSnapshotValidation =
  | { valid: true; invalidations: [] }
  | { valid: false; invalidations: ContextInvalidation[] };

export type ContextPreparationErrorCode =
  | "content_expectation_conflict"
  | "content_hash_mismatch"
  | "document_changed_during_read"
  | "duplicate_document_path"
  | "duplicate_handoff_id"
  | "duplicate_shared_context_id"
  | "document_missing"
  | "document_not_registered"
  | "document_read_failed"
  | "handoff_invalid"
  | "handoff_recipient_mismatch"
  | "invalid_expected_path"
  | "invalid_context_evidence"
  | "invalid_context_plan"
  | "invalid_path_rule"
  | "receipt_id_conflict"
  | "required_rule_unresolved"
  | "shared_context_document_missing"
  | "unsafe_document_path";

export class ContextPreparationError extends Error {
  constructor(
    readonly code: ContextPreparationErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "ContextPreparationError";
  }
}
