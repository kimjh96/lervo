import type { LoadedContext } from "@roven/context";
import type {
  AdapterContextEnvelope,
  AdapterContextReceipt,
  AdapterSession,
  ContextEvidence,
  ContextScope,
  SharedContextPublication,
} from "@roven/schemas";

export type ContextDeliveryKind = "inline" | "cas";

export type ContextDeliveryFailure =
  | "artifact_storage_failed"
  | "contract_validation_failed"
  | "required_context_missing";

export type ContextDeliveryErrorCode =
  | "artifact_store_required"
  | "artifact_storage_failed"
  | "context_receipt_mismatch"
  | "context_snapshot_invalid"
  | "injection_failed"
  | "invalid_context_evidence"
  | "invalid_context_receipt"
  | "invalid_delivery_request"
  | "invalid_inline_content"
  | "invalid_loaded_context"
  | "invalid_session"
  | "receipt_id_conflict"
  | "stale_context_generation"
  | "writing_policy_document_invalid"
  | "writing_policy_document_missing";

export const contextDeliveryFailureByCode = {
  artifact_store_required: "artifact_storage_failed",
  artifact_storage_failed: "artifact_storage_failed",
  context_receipt_mismatch: "required_context_missing",
  context_snapshot_invalid: "required_context_missing",
  injection_failed: "required_context_missing",
  invalid_context_evidence: "contract_validation_failed",
  invalid_context_receipt: "contract_validation_failed",
  invalid_delivery_request: "contract_validation_failed",
  invalid_inline_content: "contract_validation_failed",
  invalid_loaded_context: "contract_validation_failed",
  invalid_session: "contract_validation_failed",
  receipt_id_conflict: "contract_validation_failed",
  stale_context_generation: "required_context_missing",
  writing_policy_document_invalid: "contract_validation_failed",
  writing_policy_document_missing: "required_context_missing",
} as const satisfies Record<ContextDeliveryErrorCode, ContextDeliveryFailure>;

export class ContextDeliveryError extends Error {
  readonly failure: ContextDeliveryFailure;

  constructor(
    readonly code: ContextDeliveryErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "ContextDeliveryError";
    this.failure = contextDeliveryFailureByCode[code];
  }
}

export interface ContextDeliveryCandidate {
  documentId: string;
  path: string;
  contentHash: string;
  byteCount: number;
  scope: ContextScope;
  sharedContextIds: readonly string[];
  inlineContentAvailable: boolean;
}

export type ContextDeliveryPolicy = (
  candidate: Readonly<ContextDeliveryCandidate>,
) => ContextDeliveryKind;

export interface ContextArtifactPutResult {
  uri: string;
  contentHash: string;
  byteCount: number;
}

export interface ContextArtifactPort {
  put(content: Uint8Array): Promise<ContextArtifactPutResult>;
  get(uri: string): Promise<Uint8Array>;
}

export interface ContextDeliveryOptions {
  deliveryPolicy?: ContextDeliveryPolicy;
  artifactStore?: ContextArtifactPort;
}

export interface ResolvedWritingPolicy {
  writingPolicyId: string;
  documentId: string;
  contentHash: string;
}

export interface BuildContextEnvelopeInput extends ContextDeliveryOptions {
  loaded: LoadedContext;
  session: AdapterSession;
  writingPolicy: ResolvedWritingPolicy | null;
  targetTurnId: string;
  contextGeneration: number;
  createdAt: Date;
  createEnvelopeId?: () => string;
}

export interface VerifyContextReceiptInput {
  envelope: AdapterContextEnvelope;
  session: AdapterSession;
  receipt: unknown;
  expectedContextGeneration: number;
  existingEvidence?: readonly ContextEvidence[];
  createEvidenceReceiptId?: () => string;
}

export type ContextInjectionPort = (
  session: AdapterSession,
  envelope: AdapterContextEnvelope,
) => Promise<unknown>;

export interface InjectLoadedContextInput extends ContextDeliveryOptions {
  repositoryRoot: string;
  publications: readonly SharedContextPublication[];
  loaded: LoadedContext;
  session: AdapterSession;
  writingPolicy: ResolvedWritingPolicy | null;
  targetTurnId: string;
  contextGeneration: number;
  getCurrentContextGeneration: () => number;
  injectContext: ContextInjectionPort;
  now?: () => Date;
  createEnvelopeId?: () => string;
  createEvidenceReceiptId?: () => string;
}

export interface InjectedContext {
  envelope: AdapterContextEnvelope;
  receipt: AdapterContextReceipt;
  e3Evidence: readonly Extract<ContextEvidence, { state: "injected" }>[];
  evidence: readonly ContextEvidence[];
}
