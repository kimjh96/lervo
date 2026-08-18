import type { LoadedContext } from "@roven/context";
import type {
  AdapterContextEnvelope,
  AdapterContextReceipt,
  AdapterSession,
  ContextEvidence,
  SharedContextPublication,
} from "@roven/schemas";
import type { ArtifactStore } from "@roven/storage-contract";

export type ContextDeliveryMode = "auto" | "inline" | "cas";

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
  | "writing_policy_document_missing";

export class ContextDeliveryError extends Error {
  constructor(
    readonly code: ContextDeliveryErrorCode,
    readonly failure: ContextDeliveryFailure,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "ContextDeliveryError";
  }
}

export interface ContextDeliveryOptions {
  deliveryMode?: ContextDeliveryMode;
  inlineByteLimit?: number;
  artifactStore?: ArtifactStore;
}

export interface BuildContextEnvelopeInput extends ContextDeliveryOptions {
  loaded: LoadedContext;
  session: AdapterSession;
  writingPolicyDocumentId: string | null;
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
  writingPolicyDocumentId: string | null;
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
  e3Evidence: ContextEvidence[];
  evidence: ContextEvidence[];
}
