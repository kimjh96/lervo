import { randomUUID } from "node:crypto";

import { type AdapterContextEnvelope, validateSchema } from "@roven/schemas";

import {
  type BuildContextEnvelopeInput,
  ContextDeliveryError,
} from "./types.js";
import {
  assertGeneration,
  assertSessionCoordinates,
  hashBytes,
  validateLoadedContext,
  validateSession,
} from "./validation.js";

const defaultInlineByteLimit = 64 * 1024;

function defaultEnvelopeId(): string {
  return `env_${randomUUID().replaceAll("-", "").slice(0, 16)}`;
}

function decodeInline(bytes: Uint8Array): string | null {
  try {
    const content = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return Buffer.from(content, "utf8").equals(Buffer.from(bytes)) ? content : null;
  } catch {
    return null;
  }
}

async function storeInCas(
  documentId: string,
  bytes: Uint8Array,
  expectedHash: string,
  artifactStore: NonNullable<BuildContextEnvelopeInput["artifactStore"]>,
): Promise<{ kind: "cas"; uri: string }> {
  try {
    const result = await artifactStore.put(bytes);
    const stored = await artifactStore.get(result.uri);
    const expectedUri = `roven-cas://sha256/${expectedHash.slice("sha256:".length)}`;
    if (
      result.uri !== expectedUri ||
      result.contentHash !== expectedHash ||
      result.byteCount !== bytes.byteLength ||
      hashBytes(stored) !== expectedHash ||
      stored.byteLength !== bytes.byteLength
    ) {
      throw new ContextDeliveryError(
        "artifact_storage_failed",
        "artifact_storage_failed",
        `CAS 검증이 실패했습니다: ${documentId}`,
      );
    }
    return { kind: "cas", uri: result.uri };
  } catch (error) {
    if (error instanceof ContextDeliveryError) throw error;
    throw new ContextDeliveryError(
      "artifact_storage_failed",
      "artifact_storage_failed",
      `CAS에 context 문서를 안전하게 저장하지 못했습니다: ${documentId}`,
      { cause: error },
    );
  }
}

export async function buildContextEnvelope(
  input: BuildContextEnvelopeInput,
): Promise<AdapterContextEnvelope> {
  validateSession(input.session);
  validateLoadedContext(input.loaded);
  assertSessionCoordinates(input.loaded, input.session);
  assertGeneration(input.contextGeneration, "contextGeneration");

  if (input.targetTurnId.length === 0 || !Number.isFinite(input.createdAt.getTime())) {
    throw new ContextDeliveryError(
      "invalid_delivery_request",
      "contract_validation_failed",
      "대상 turn ID와 생성 시각이 유효해야 합니다.",
    );
  }
  if (
    input.inlineByteLimit !== undefined &&
    (!Number.isSafeInteger(input.inlineByteLimit) || input.inlineByteLimit < 0)
  ) {
    throw new ContextDeliveryError(
      "invalid_delivery_request",
      "contract_validation_failed",
      "inlineByteLimit은 0 이상의 안전한 정수여야 합니다.",
    );
  }

  if (input.session.writingPolicyId === null) {
    if (input.writingPolicyDocumentId !== null) {
      throw new ContextDeliveryError(
        "invalid_delivery_request",
        "contract_validation_failed",
        "Writing policy가 없는 session에는 정책 문서를 지정할 수 없습니다.",
      );
    }
  } else if (
    input.writingPolicyDocumentId === null ||
    !input.loaded.documents.some(
      (document) => document.documentId === input.writingPolicyDocumentId,
    )
  ) {
    throw new ContextDeliveryError(
      "writing_policy_document_missing",
      "required_context_missing",
      "선택된 writing policy의 E2 문서가 필요합니다.",
    );
  }

  const mode = input.deliveryMode ?? "auto";
  if (mode !== "auto" && mode !== "inline" && mode !== "cas") {
    throw new ContextDeliveryError(
      "invalid_delivery_request",
      "contract_validation_failed",
      "지원하지 않는 context delivery mode입니다.",
    );
  }
  const inlineByteLimit = input.inlineByteLimit ?? defaultInlineByteLimit;
  const documents = await Promise.all(
    input.loaded.documents.map(async (document) => {
      const inline = decodeInline(document.bytes);
      const useInline =
        mode === "inline" ||
        (mode === "auto" && document.byteCount <= inlineByteLimit && inline !== null);
      let delivery: { kind: "inline"; content: string } | { kind: "cas"; uri: string };
      if (useInline) {
        if (inline === null) {
          throw new ContextDeliveryError(
            "invalid_inline_content",
            "contract_validation_failed",
            `UTF-8로 손실 없이 전달할 수 없는 문서입니다: ${document.documentId}`,
          );
        }
        delivery = { kind: "inline", content: inline };
      } else {
        if (input.artifactStore === undefined) {
          throw new ContextDeliveryError(
            "artifact_store_required",
            "artifact_storage_failed",
            `CAS 전달에 ArtifactStore가 필요합니다: ${document.documentId}`,
          );
        }
        delivery = await storeInCas(
          document.documentId,
          document.bytes,
          document.contentHash,
          input.artifactStore,
        );
      }
      return {
        documentId: document.documentId,
        path: document.path,
        contentHash: document.contentHash,
        byteCount: document.byteCount,
        scope: document.scope,
        delivery,
      };
    }),
  );

  const envelope: AdapterContextEnvelope = {
    kind: "context_envelope",
    schemaVersion: 1,
    envelopeId: (input.createEnvelopeId ?? defaultEnvelopeId)(),
    adapterId: input.session.adapterId,
    projectId: input.session.projectId,
    runId: input.session.runId,
    sessionId: input.session.sessionId,
    roleId: input.session.roleId,
    writingPolicyId: input.session.writingPolicyId,
    writingPolicyDocumentId: input.writingPolicyDocumentId,
    targetTurnId: input.targetTurnId,
    contextGeneration: input.contextGeneration,
    documents,
    createdAt: input.createdAt.toISOString(),
  };
  const validation = validateSchema("adapter", envelope);
  if (!validation.valid) {
    throw new ContextDeliveryError(
      "invalid_delivery_request",
      "contract_validation_failed",
      "유효한 provider-neutral context envelope를 만들지 못했습니다.",
      { cause: validation.errors },
    );
  }
  return envelope;
}
