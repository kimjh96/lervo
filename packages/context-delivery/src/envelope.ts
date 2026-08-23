import { randomUUID } from "node:crypto";

import { inspectContextEnvelopeBinding } from "@lervo/adapter-contract";
import type { AdapterContextEnvelope } from "@lervo/schemas";

import { materializeContextDocuments } from "./materialize.js";
import {
  type BuildContextEnvelopeInput,
  ContextDeliveryError,
} from "./types.js";
import {
  assertGeneration,
  assertSessionCoordinates,
  validateLoadedContext,
  validateSession,
} from "./validation.js";
import { resolveWritingPolicyDocumentId } from "./writing-policy.js";

function defaultEnvelopeId(): string {
  return `env_${randomUUID().replaceAll("-", "").slice(0, 16)}`;
}

export async function buildContextEnvelope(
  input: BuildContextEnvelopeInput,
): Promise<AdapterContextEnvelope> {
  const session = structuredClone(input.session);
  const createdAtInput = new Date(input.createdAt.getTime());
  const targetTurnId = input.targetTurnId;
  const contextGeneration = input.contextGeneration;
  validateSession(session);
  validateLoadedContext(input.loaded);
  assertSessionCoordinates(input.loaded, session);
  assertGeneration(contextGeneration, "contextGeneration");

  const createdAt = createdAtInput.getTime();
  if (
    targetTurnId.length === 0 ||
    !Number.isFinite(createdAt) ||
    createdAt < Date.parse(input.loaded.loadedAt) ||
    createdAt < Date.parse(session.startedAt)
  ) {
    throw new ContextDeliveryError(
      "invalid_delivery_request",
      "The envelope creation time must be after E2 loading and adapter session start.",
    );
  }
  const writingPolicyDocumentId = resolveWritingPolicyDocumentId({ ...input, session });
  const documents = await materializeContextDocuments({ loaded: input.loaded, options: input });
  let envelopeId: string;
  try {
    envelopeId = (input.createEnvelopeId ?? defaultEnvelopeId)();
  } catch {
    throw new ContextDeliveryError(
      "invalid_delivery_request",
      "Could not create the context envelope ID.",
    );
  }
  const envelope: AdapterContextEnvelope = {
    kind: "context_envelope",
    schemaVersion: 1,
    envelopeId,
    adapterId: session.adapterId,
    projectId: session.projectId,
    runId: session.runId,
    sessionId: session.sessionId,
    roleId: session.roleId,
    writingPolicyId: session.writingPolicyId,
    writingPolicyDocumentId,
    targetTurnId,
    contextGeneration,
    documents,
    createdAt: createdAtInput.toISOString(),
  };
  const binding = inspectContextEnvelopeBinding({
    session,
    envelope,
    expectedContextGeneration: contextGeneration,
  });
  if (!binding.passed) {
    throw new ContextDeliveryError(
      "invalid_delivery_request",
      "Could not create a valid provider-neutral context envelope.",
      { cause: binding.violations },
    );
  }
  return envelope;
}
