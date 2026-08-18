import {
  ContextMaterializationError,
  materializeContextEnvelope,
} from "@lervo/adapter-contract";
import type { AdapterContextEnvelope, AdapterSession } from "@lervo/schemas";

import { ClaudeAdapterError } from "./types.js";

export async function buildManagedContextMessage(
  session: AdapterSession,
  envelope: AdapterContextEnvelope,
  resolveArtifact: ((uri: string) => Promise<Uint8Array>) | undefined,
): Promise<string> {
  let materialized;
  try {
    materialized = await materializeContextEnvelope(session, envelope, resolveArtifact);
  } catch (error) {
    if (error instanceof ContextMaterializationError) {
      throw new ClaudeAdapterError(error.code, error.message);
    }
    throw error;
  }

  return JSON.stringify({
    kind: "lervo_managed_context",
    envelopeId: envelope.envelopeId,
    targetTurnId: envelope.targetTurnId,
    contextGeneration: envelope.contextGeneration,
    roleId: envelope.roleId,
    writingPolicyId: envelope.writingPolicyId,
    writingPolicyDocumentId: envelope.writingPolicyDocumentId,
    documents: materialized.map(({ document, content }) => ({
      documentId: document.documentId,
      path: document.path,
      contentHash: document.contentHash,
      scope: document.scope,
      content,
    })),
  });
}
