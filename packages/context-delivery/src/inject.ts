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
    writingPolicy: input.writingPolicy,
    targetTurnId: input.targetTurnId,
    contextGeneration: input.contextGeneration,
    createdAt,
    ...(input.deliveryPolicy === undefined
      ? {}
      : { deliveryPolicy: input.deliveryPolicy }),
    ...(input.artifactStore === undefined ? {} : { artifactStore: input.artifactStore }),
    ...(input.createEnvelopeId === undefined
      ? {}
      : { createEnvelopeId: input.createEnvelopeId }),
  });

  assertCurrentGeneration(input);
  await assertFreshSnapshot(input, now());
  assertCurrentGeneration(input);

  const sessionSnapshot = structuredClone(input.session);
  const envelopeSnapshot = structuredClone(envelope);
  const adapterSession = structuredClone(sessionSnapshot);
  const adapterEnvelope = structuredClone(envelopeSnapshot);
  let rawReceipt: unknown;
  try {
    rawReceipt = await input.injectContext(adapterSession, adapterEnvelope);
  } catch {
    throw new ContextDeliveryError(
      "injection_failed",
      "Adapter가 controlled context 입력을 완료하지 못했습니다.",
    );
  }
  await assertFreshSnapshot(input, now());
  const currentGeneration = input.getCurrentContextGeneration();
  assertGeneration(currentGeneration, "currentContextGeneration");
  const verified = verifyContextReceipt({
    envelope: envelopeSnapshot,
    session: sessionSnapshot,
    receipt: rawReceipt,
    expectedContextGeneration: currentGeneration,
    existingEvidence: input.loaded.evidence,
    ...(input.createEvidenceReceiptId === undefined
      ? {}
      : { createEvidenceReceiptId: input.createEvidenceReceiptId }),
  });
  return {
    envelope: envelopeSnapshot,
    receipt: verified.receipt,
    e3Evidence: verified.evidence,
    evidence: [...input.loaded.evidence, ...verified.evidence],
  };
}
