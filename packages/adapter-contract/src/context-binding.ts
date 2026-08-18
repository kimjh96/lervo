import {
  type AdapterContextEnvelope,
  type AdapterContextReceipt,
  type AdapterSession,
  contextScopesEqual,
  validateSchema,
} from "@lervo/schemas";

export type ContextBindingViolationCode =
  | "session_invalid"
  | "envelope_invalid"
  | "envelope_session_mismatch"
  | "envelope_timing_mismatch"
  | "stale_context_generation"
  | "envelope_document_duplicate"
  | "writing_policy_document_missing"
  | "receipt_invalid"
  | "receipt_session_mismatch"
  | "receipt_timing_mismatch"
  | "receipt_document_mismatch";

export interface ContextBindingViolation {
  code: ContextBindingViolationCode;
  detail: string;
}

export interface ContextBindingReport {
  passed: boolean;
  violations: ContextBindingViolation[];
}

function isMessageKind<T extends { kind: string }>(
  value: unknown,
  kind: T["kind"],
): value is T {
  if (typeof value !== "object" || value === null || !("kind" in value)) return false;
  return value.kind === kind && validateSchema("adapter", value).valid;
}

function report(violations: ContextBindingViolation[]): ContextBindingReport {
  return { passed: violations.length === 0, violations };
}

export function inspectContextEnvelopeBinding(input: {
  session: unknown;
  envelope: unknown;
  expectedContextGeneration?: number;
}): ContextBindingReport {
  const violations: ContextBindingViolation[] = [];
  if (!isMessageKind<AdapterSession>(input.session, "session")) {
    violations.push({ code: "session_invalid", detail: "managed adapter session is invalid" });
    return report(violations);
  }
  if (!isMessageKind<AdapterContextEnvelope>(input.envelope, "context_envelope")) {
    violations.push({ code: "envelope_invalid", detail: "context envelope is invalid" });
    return report(violations);
  }

  const { session, envelope } = input;
  if (
    envelope.adapterId !== session.adapterId ||
    envelope.projectId !== session.projectId ||
    envelope.runId !== session.runId ||
    envelope.sessionId !== session.sessionId ||
    envelope.roleId !== session.roleId ||
    envelope.writingPolicyId !== session.writingPolicyId
  ) {
    violations.push({
      code: "envelope_session_mismatch",
      detail: "context envelope is not bound to the managed adapter session",
    });
  }
  if (Date.parse(envelope.createdAt) < Date.parse(session.startedAt)) {
    violations.push({
      code: "envelope_timing_mismatch",
      detail: "context envelope predates the managed adapter session",
    });
  }
  if (
    input.expectedContextGeneration !== undefined &&
    envelope.contextGeneration !== input.expectedContextGeneration
  ) {
    violations.push({
      code: "stale_context_generation",
      detail: "context envelope does not use the current context generation",
    });
  }

  const documentIds = new Set<string>();
  for (const document of envelope.documents) {
    if (documentIds.has(document.documentId)) {
      violations.push({
        code: "envelope_document_duplicate",
        detail: `context envelope repeats document ${document.documentId}`,
      });
    }
    documentIds.add(document.documentId);
  }
  if (
    (session.writingPolicyId !== null && envelope.writingPolicyDocumentId === null) ||
    (envelope.writingPolicyDocumentId !== null &&
      !documentIds.has(envelope.writingPolicyDocumentId))
  ) {
    violations.push({
      code: "writing_policy_document_missing",
      detail: "context envelope does not contain its selected writing policy document",
    });
  }
  return report(violations);
}

export function inspectContextReceiptBinding(input: {
  session: unknown;
  envelope: unknown;
  receipt: unknown;
  expectedContextGeneration?: number;
}): ContextBindingReport {
  const envelopeReport = inspectContextEnvelopeBinding(input);
  if (!envelopeReport.passed) return envelopeReport;
  const session = input.session as AdapterSession;
  const envelope = input.envelope as AdapterContextEnvelope;
  if (!isMessageKind<AdapterContextReceipt>(input.receipt, "context_receipt")) {
    return report([
      { code: "receipt_invalid", detail: "adapter context receipt is invalid" },
    ]);
  }
  const receipt = input.receipt;
  const violations: ContextBindingViolation[] = [];
  if (
    receipt.envelopeId !== envelope.envelopeId ||
    receipt.adapterId !== session.adapterId ||
    receipt.projectId !== session.projectId ||
    receipt.runId !== session.runId ||
    receipt.sessionId !== session.sessionId ||
    receipt.roleId !== session.roleId ||
    receipt.writingPolicyId !== session.writingPolicyId ||
    receipt.writingPolicyDocumentId !== envelope.writingPolicyDocumentId ||
    receipt.provider !== session.provider ||
    receipt.providerSessionId !== session.providerSessionId ||
    receipt.targetTurnId !== envelope.targetTurnId ||
    receipt.contextGeneration !== envelope.contextGeneration ||
    (input.expectedContextGeneration !== undefined &&
      receipt.contextGeneration !== input.expectedContextGeneration) ||
    receipt.controlledInput !== true
  ) {
    violations.push({
      code: "receipt_session_mismatch",
      detail: "context receipt is not bound to the exact envelope and managed session",
    });
  }
  if (
    Date.parse(receipt.acceptedAt) < Date.parse(envelope.createdAt) ||
    Date.parse(receipt.acceptedAt) < Date.parse(session.startedAt)
  ) {
    violations.push({
      code: "receipt_timing_mismatch",
      detail: "context receipt predates its envelope or managed session",
    });
  }

  const expectedDocuments = new Map(
    envelope.documents.map((document) => [document.documentId, document]),
  );
  const receivedIds = new Set<string>();
  let documentsMatch = receipt.documents.length === expectedDocuments.size;
  for (const document of receipt.documents) {
    if (receivedIds.has(document.documentId)) documentsMatch = false;
    receivedIds.add(document.documentId);
    const expected = expectedDocuments.get(document.documentId);
    if (
      expected === undefined ||
      expected.contentHash !== document.contentHash ||
      !contextScopesEqual(expected.scope, document.scope) ||
      document.status !== "injected"
    ) {
      documentsMatch = false;
    }
  }
  if (
    !documentsMatch ||
    (receipt.writingPolicyDocumentId !== null &&
      !receivedIds.has(receipt.writingPolicyDocumentId))
  ) {
    violations.push({
      code: "receipt_document_mismatch",
      detail: "context receipt does not prove the exact envelope document set",
    });
  }
  return report(violations);
}
