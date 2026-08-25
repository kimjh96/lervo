import { type WritingContract, validateSchema } from "@lervo/schemas";

import { type BuildContextEnvelopeInput, ContextDeliveryError } from "./types.js";

export function resolveWritingPolicyDocumentId(input: BuildContextEnvelopeInput): string | null {
  const { writingPolicy, session } = input;
  if (session.writingPolicyId === null) {
    if (writingPolicy !== null) {
      throw new ContextDeliveryError(
        "invalid_delivery_request",
        "A policy binding cannot be specified for a session without a writing policy.",
      );
    }
    return null;
  }
  if (writingPolicy === null || writingPolicy.writingPolicyId !== session.writingPolicyId) {
    throw new ContextDeliveryError(
      "writing_policy_document_missing",
      "A policy binding matching the session writing policy ID is required.",
    );
  }
  const document = input.loaded.documents.find(
    (candidate) => candidate.documentId === writingPolicy.documentId,
  );
  if (document === undefined || document.contentHash !== writingPolicy.contentHash) {
    throw new ContextDeliveryError(
      "writing_policy_document_missing",
      "The writing policy binding document ID and content hash differ from the E2 document.",
    );
  }

  let contract: unknown;
  try {
    contract = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(document.bytes));
  } catch {
    throw new ContextDeliveryError(
      "writing_policy_document_invalid",
      "The writing policy document must satisfy the UTF-8 JSON contract.",
    );
  }
  const validation = validateSchema("writingContract", contract);
  if (
    !validation.valid ||
    (contract as Partial<WritingContract>).writingPolicyId !== writingPolicy.writingPolicyId
  ) {
    throw new ContextDeliveryError(
      "writing_policy_document_invalid",
      "The writing policy document contract or policy ID differs from the binding.",
      { cause: validation.errors },
    );
  }
  return document.documentId;
}
