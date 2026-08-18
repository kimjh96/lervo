import { randomUUID } from "node:crypto";

import { ContextEvidenceCollector } from "@roven/context";
import {
  type AdapterContextReceipt,
  type ContextEvidence,
  validateSchema,
} from "@roven/schemas";

import {
  ContextDeliveryError,
  type VerifyContextReceiptInput,
} from "./types.js";
import {
  assertGeneration,
  sameScope,
  validateSession,
} from "./validation.js";

function defaultEvidenceReceiptId(): string {
  return `ctx_${randomUUID().replaceAll("-", "").slice(0, 16)}`;
}

function mismatch(message: string): never {
  throw new ContextDeliveryError(
    "context_receipt_mismatch",
    "required_context_missing",
    message,
  );
}

function parseReceipt(receipt: unknown): AdapterContextReceipt {
  const validation = validateSchema("adapter", receipt);
  if (!validation.valid || typeof receipt !== "object" || receipt === null) {
    throw new ContextDeliveryError(
      "invalid_context_receipt",
      "contract_validation_failed",
      "Adapter가 유효한 context receipt를 반환하지 않았습니다.",
      { cause: validation.errors },
    );
  }
  const candidate = receipt as { kind?: unknown };
  if (candidate.kind !== "context_receipt") {
    throw new ContextDeliveryError(
      "invalid_context_receipt",
      "contract_validation_failed",
      "Adapter가 context receipt가 아닌 메시지를 반환했습니다.",
    );
  }
  return receipt as AdapterContextReceipt;
}

export function verifyContextReceipt(
  input: VerifyContextReceiptInput,
): { receipt: AdapterContextReceipt; evidence: ContextEvidence[] } {
  validateSession(input.session);
  assertGeneration(input.expectedContextGeneration, "expectedContextGeneration");
  const envelopeValidation = validateSchema("adapter", input.envelope);
  if (!envelopeValidation.valid) {
    throw new ContextDeliveryError(
      "invalid_delivery_request",
      "contract_validation_failed",
      "검증할 context envelope가 유효하지 않습니다.",
      { cause: envelopeValidation.errors },
    );
  }
  if (input.envelope.contextGeneration !== input.expectedContextGeneration) {
    throw new ContextDeliveryError(
      "stale_context_generation",
      "required_context_missing",
      "Context envelope가 현재 generation보다 오래되었습니다.",
    );
  }
  if (
    input.envelope.adapterId !== input.session.adapterId ||
    input.envelope.projectId !== input.session.projectId ||
    input.envelope.runId !== input.session.runId ||
    input.envelope.sessionId !== input.session.sessionId ||
    input.envelope.roleId !== input.session.roleId ||
    input.envelope.writingPolicyId !== input.session.writingPolicyId
  ) {
    throw new ContextDeliveryError(
      "invalid_delivery_request",
      "contract_validation_failed",
      "Context envelope가 managed adapter session 좌표와 다릅니다.",
    );
  }

  const receipt = parseReceipt(input.receipt);
  if (
    receipt.envelopeId !== input.envelope.envelopeId ||
    receipt.adapterId !== input.session.adapterId ||
    receipt.projectId !== input.session.projectId ||
    receipt.runId !== input.session.runId ||
    receipt.sessionId !== input.session.sessionId ||
    receipt.roleId !== input.session.roleId ||
    receipt.writingPolicyId !== input.session.writingPolicyId ||
    receipt.writingPolicyDocumentId !== input.envelope.writingPolicyDocumentId ||
    receipt.provider !== input.session.provider ||
    receipt.providerSessionId !== input.session.providerSessionId ||
    receipt.targetTurnId !== input.envelope.targetTurnId ||
    receipt.contextGeneration !== input.expectedContextGeneration ||
    receipt.controlledInput !== true
  ) {
    mismatch("Context receipt가 envelope와 managed session 좌표에 묶이지 않았습니다.");
  }
  if (
    Date.parse(receipt.acceptedAt) < Date.parse(input.envelope.createdAt) ||
    Date.parse(receipt.acceptedAt) < Date.parse(input.session.startedAt)
  ) {
    mismatch("Context receipt가 envelope 또는 session보다 먼저 생성되었습니다.");
  }

  const expectedDocuments = new Map<string, (typeof input.envelope.documents)[number]>();
  for (const document of input.envelope.documents) {
    if (expectedDocuments.has(document.documentId)) {
      mismatch(`Envelope 문서 ID가 중복되었습니다: ${document.documentId}`);
    }
    expectedDocuments.set(document.documentId, document);
  }
  if (
    input.envelope.writingPolicyDocumentId !== null &&
    !expectedDocuments.has(input.envelope.writingPolicyDocumentId)
  ) {
    throw new ContextDeliveryError(
      "invalid_delivery_request",
      "contract_validation_failed",
      "Context envelope에 선택된 writing policy 문서가 없습니다.",
    );
  }
  const receivedIds = new Set<string>();
  for (const document of receipt.documents) {
    if (receivedIds.has(document.documentId)) {
      mismatch(`Receipt 문서 ID가 중복되었습니다: ${document.documentId}`);
    }
    receivedIds.add(document.documentId);
    const expected = expectedDocuments.get(document.documentId);
    if (
      expected === undefined ||
      expected.contentHash !== document.contentHash ||
      !sameScope(expected.scope, document.scope) ||
      document.status !== "injected"
    ) {
      mismatch(`Receipt 문서가 envelope와 다릅니다: ${document.documentId}`);
    }
  }
  if (receivedIds.size !== expectedDocuments.size) {
    mismatch("Receipt가 envelope의 정확한 문서 집합을 증명하지 않습니다.");
  }
  if (
    receipt.writingPolicyDocumentId !== null &&
    !receivedIds.has(receipt.writingPolicyDocumentId)
  ) {
    mismatch("Receipt에 선택된 writing policy 문서가 없습니다.");
  }

  const createEvidenceReceiptId =
    input.createEvidenceReceiptId ?? defaultEvidenceReceiptId;
  try {
    const collector = new ContextEvidenceCollector(input.existingEvidence ?? []);
    const existingCount = collector.values().length;
    for (const document of input.envelope.documents) {
      collector.add({
        receiptId: createEvidenceReceiptId(),
        adapterReceiptId: receipt.receiptId,
        projectId: receipt.projectId,
        runId: receipt.runId,
        sessionId: receipt.sessionId,
        documentId: document.documentId,
        state: "injected",
        recordedAt: receipt.acceptedAt,
        scope: document.scope,
        contentHash: document.contentHash,
        provider: receipt.provider,
        providerSessionId: receipt.providerSessionId,
        adapterId: receipt.adapterId,
        envelopeId: receipt.envelopeId,
        targetTurnId: receipt.targetTurnId,
        contextGeneration: receipt.contextGeneration,
        controlledInput: true,
      });
    }
    return {
      receipt,
      evidence: collector.values().slice(existingCount),
    };
  } catch (error) {
    const code =
      error instanceof Error && "code" in error && error.code === "receipt_id_conflict"
        ? "receipt_id_conflict"
        : "invalid_context_evidence";
    throw new ContextDeliveryError(
      code,
      "contract_validation_failed",
      "유효하고 고유한 E3 evidence를 만들지 못했습니다.",
      { cause: error },
    );
  }
}
