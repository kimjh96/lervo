import { type WritingContract, validateSchema } from "@roven/schemas";

import {
  type BuildContextEnvelopeInput,
  ContextDeliveryError,
} from "./types.js";

export function resolveWritingPolicyDocumentId(
  input: BuildContextEnvelopeInput,
): string | null {
  const { writingPolicy, session } = input;
  if (session.writingPolicyId === null) {
    if (writingPolicy !== null) {
      throw new ContextDeliveryError(
        "invalid_delivery_request",
        "Writing policy가 없는 session에는 정책 binding을 지정할 수 없습니다.",
      );
    }
    return null;
  }
  if (writingPolicy === null || writingPolicy.writingPolicyId !== session.writingPolicyId) {
    throw new ContextDeliveryError(
      "writing_policy_document_missing",
      "Session의 writing policy ID와 일치하는 정책 binding이 필요합니다.",
    );
  }
  const document = input.loaded.documents.find(
    (candidate) => candidate.documentId === writingPolicy.documentId,
  );
  if (document === undefined || document.contentHash !== writingPolicy.contentHash) {
    throw new ContextDeliveryError(
      "writing_policy_document_missing",
      "Writing policy binding의 문서 ID와 content hash가 E2 문서와 다릅니다.",
    );
  }

  let contract: unknown;
  try {
    contract = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(document.bytes));
  } catch {
    throw new ContextDeliveryError(
      "writing_policy_document_invalid",
      "Writing policy 문서는 UTF-8 JSON 계약이어야 합니다.",
    );
  }
  const validation = validateSchema("writingContract", contract);
  if (
    !validation.valid ||
    (contract as Partial<WritingContract>).writingPolicyId !== writingPolicy.writingPolicyId
  ) {
    throw new ContextDeliveryError(
      "writing_policy_document_invalid",
      "Writing policy 문서의 계약 또는 policy ID가 binding과 다릅니다.",
      { cause: validation.errors },
    );
  }
  return document.documentId;
}
