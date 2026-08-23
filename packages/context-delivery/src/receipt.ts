import { randomUUID } from "node:crypto";

import { inspectContextReceiptBinding } from "@lervo/adapter-contract";
import {
  type AdapterContextReceipt,
  cloneContextScope,
  type ContextEvidence,
  validateSchema,
} from "@lervo/schemas";

import {
  ContextDeliveryError,
  type VerifyContextReceiptInput,
} from "./types.js";
import { assertGeneration } from "./validation.js";

type InjectedEvidence = Extract<ContextEvidence, { state: "injected" }>;

function defaultEvidenceReceiptId(): string {
  return `ctx_${randomUUID().replaceAll("-", "").slice(0, 16)}`;
}

function createEvidenceReceiptId(factory: () => string): string {
  try {
    return factory();
  } catch {
    throw new ContextDeliveryError(
      "invalid_context_evidence",
      "Could not create the E3 context receipt ID.",
    );
  }
}

function throwBindingError(
  violations: ReturnType<typeof inspectContextReceiptBinding>["violations"],
): never {
  if (violations.some((item) => item.code === "stale_context_generation")) {
    throw new ContextDeliveryError(
      "stale_context_generation",
      "The context envelope or receipt is older than the current generation.",
    );
  }
  if (violations.some((item) => item.code === "receipt_invalid")) {
    throw new ContextDeliveryError(
      "invalid_context_receipt",
      "The adapter did not return a valid context receipt.",
      { cause: violations },
    );
  }
  if (
    violations.some((item) =>
      [
        "session_invalid",
        "envelope_invalid",
        "envelope_session_mismatch",
        "envelope_timing_mismatch",
        "envelope_document_duplicate",
        "writing_policy_document_missing",
      ].includes(item.code),
    )
  ) {
    throw new ContextDeliveryError(
      "invalid_delivery_request",
      "The envelope or managed session binding to verify is invalid.",
      { cause: violations },
    );
  }
  throw new ContextDeliveryError(
    "context_receipt_mismatch",
    "The context receipt does not prove exact envelope injection.",
    { cause: violations },
  );
}

function createInjectedEvidence(input: {
  envelope: VerifyContextReceiptInput["envelope"];
  receipt: AdapterContextReceipt;
  existingEvidence: readonly ContextEvidence[];
  createReceiptId: () => string;
}): InjectedEvidence[] {
  const receiptIds = new Set<string>();
  for (const evidence of input.existingEvidence) {
    const validation = validateSchema("contextEvidence", evidence);
    if (!validation.valid) {
      throw new ContextDeliveryError(
        "invalid_context_evidence",
        `Existing context evidence is invalid: ${evidence.receiptId}`,
        { cause: validation.errors },
      );
    }
    if (receiptIds.has(evidence.receiptId)) {
      throw new ContextDeliveryError(
        "receipt_id_conflict",
        `An existing context receipt ID is duplicated: ${evidence.receiptId}`,
      );
    }
    receiptIds.add(evidence.receiptId);
  }

  return input.envelope.documents.map((document): InjectedEvidence => {
    const receiptId = createEvidenceReceiptId(input.createReceiptId);
    if (receiptIds.has(receiptId)) {
      throw new ContextDeliveryError(
        "receipt_id_conflict",
        `An E3 context receipt ID is duplicated: ${receiptId}`,
      );
    }
    const evidence: InjectedEvidence = {
      receiptId,
      adapterReceiptId: input.receipt.receiptId,
      projectId: input.receipt.projectId,
      runId: input.receipt.runId,
      sessionId: input.receipt.sessionId,
      documentId: document.documentId,
      state: "injected",
      recordedAt: input.receipt.acceptedAt,
      scope: cloneContextScope(document.scope),
      contentHash: document.contentHash,
      provider: input.receipt.provider,
      providerSessionId: input.receipt.providerSessionId,
      adapterId: input.receipt.adapterId,
      envelopeId: input.receipt.envelopeId,
      targetTurnId: input.receipt.targetTurnId,
      contextGeneration: input.receipt.contextGeneration,
      controlledInput: true,
      ...(document.knowledgeContext === undefined
        ? {}
        : { knowledgeContext: structuredClone(document.knowledgeContext) }),
    };
    const validation = validateSchema("contextEvidence", evidence);
    if (!validation.valid) {
      throw new ContextDeliveryError(
        "invalid_context_evidence",
        `Could not create valid E3 evidence: ${receiptId}`,
        { cause: validation.errors },
      );
    }
    receiptIds.add(receiptId);
    return evidence;
  });
}

export function verifyContextReceipt(
  input: VerifyContextReceiptInput,
): { receipt: AdapterContextReceipt; evidence: InjectedEvidence[] } {
  assertGeneration(input.expectedContextGeneration, "expectedContextGeneration");
  const binding = inspectContextReceiptBinding({
    session: input.session,
    envelope: input.envelope,
    receipt: input.receipt,
    expectedContextGeneration: input.expectedContextGeneration,
  });
  if (!binding.passed) throwBindingError(binding.violations);

  const receipt = input.receipt as AdapterContextReceipt;
  const evidence = createInjectedEvidence({
    envelope: input.envelope,
    receipt,
    existingEvidence: input.existingEvidence ?? [],
    createReceiptId: input.createEvidenceReceiptId ?? defaultEvidenceReceiptId,
  });
  return { receipt, evidence };
}
