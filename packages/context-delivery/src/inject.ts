import { validateContextSnapshot } from "@roven/context";

import { buildContextEnvelope } from "./envelope.js";
import { verifyContextReceipt } from "./receipt.js";
import {
  ContextDeliveryError,
  type InjectedContext,
  type InjectLoadedContextInput,
} from "./types.js";
import { assertGeneration } from "./validation.js";

function assertCurrentGeneration(input: InjectLoadedContextInput): void {
  const current = input.getCurrentContextGeneration();
  assertGeneration(current, "currentContextGeneration");
  if (current !== input.contextGeneration) {
    throw new ContextDeliveryError(
      "stale_context_generation",
      "required_context_missing",
      "Context generation이 바뀌어 재주입이 필요합니다.",
    );
  }
}

async function assertFreshSnapshot(
  input: InjectLoadedContextInput,
  at: Date,
): Promise<void> {
  const freshness = await validateContextSnapshot({
    repositoryRoot: input.repositoryRoot,
    loaded: input.loaded,
    publications: input.publications,
    at,
  });
  if (!freshness.valid) {
    throw new ContextDeliveryError(
      "context_snapshot_invalid",
      "required_context_missing",
      `Context snapshot이 유효하지 않습니다: ${freshness.invalidations
        .map((item) => `${item.documentId}:${item.reason}`)
        .join(",")}`,
    );
  }
}

export async function injectLoadedContext(
  input: InjectLoadedContextInput,
): Promise<InjectedContext> {
  const now = input.now ?? (() => new Date());
  assertCurrentGeneration(input);
  const createdAt = now();
  await assertFreshSnapshot(input, createdAt);
  const envelope = await buildContextEnvelope({
    loaded: input.loaded,
    session: input.session,
    writingPolicyDocumentId: input.writingPolicyDocumentId,
    targetTurnId: input.targetTurnId,
    contextGeneration: input.contextGeneration,
    createdAt,
    ...(input.deliveryMode === undefined ? {} : { deliveryMode: input.deliveryMode }),
    ...(input.inlineByteLimit === undefined
      ? {}
      : { inlineByteLimit: input.inlineByteLimit }),
    ...(input.artifactStore === undefined ? {} : { artifactStore: input.artifactStore }),
    ...(input.createEnvelopeId === undefined
      ? {}
      : { createEnvelopeId: input.createEnvelopeId }),
  });

  assertCurrentGeneration(input);
  await assertFreshSnapshot(input, now());
  assertCurrentGeneration(input);

  let rawReceipt: unknown;
  try {
    rawReceipt = await input.injectContext(input.session, envelope);
  } catch {
    throw new ContextDeliveryError(
      "injection_failed",
      "required_context_missing",
      "Adapter가 controlled context 입력을 완료하지 못했습니다.",
    );
  }
  const currentGeneration = input.getCurrentContextGeneration();
  assertGeneration(currentGeneration, "currentContextGeneration");
  const verified = verifyContextReceipt({
    envelope,
    session: input.session,
    receipt: rawReceipt,
    expectedContextGeneration: currentGeneration,
    existingEvidence: input.loaded.evidence,
    ...(input.createEvidenceReceiptId === undefined
      ? {}
      : { createEvidenceReceiptId: input.createEvidenceReceiptId }),
  });
  return {
    envelope,
    receipt: verified.receipt,
    e3Evidence: verified.evidence,
    evidence: [...input.loaded.evidence, ...verified.evidence],
  };
}
