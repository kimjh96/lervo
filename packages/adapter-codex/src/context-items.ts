import {
  ContextMaterializationError,
  managedContextDocumentReferenceMetadata,
  managedContextReferenceInstruction,
  materializeContextEnvelope,
} from "@lervo/adapter-contract";
import type { AdapterContextEnvelope, AdapterSession } from "@lervo/schemas";

import { CodexAdapterError } from "./types.js";

export async function buildManagedContextItems(
  session: AdapterSession,
  envelope: AdapterContextEnvelope,
  resolveArtifact: ((uri: string) => Promise<Uint8Array>) | undefined,
): Promise<unknown[]> {
  let materialized;
  try {
    materialized = await materializeContextEnvelope(session, envelope, resolveArtifact);
  } catch (error) {
    if (error instanceof ContextMaterializationError) {
      throw new CodexAdapterError(error.code, error.message, undefined, { cause: error });
    }
    throw error;
  }

  const items: unknown[] = [];
  for (const { document, content } of materialized) {
    const managedContext = {
      kind: "lervo_managed_context",
      envelopeId: envelope.envelopeId,
      targetTurnId: envelope.targetTurnId,
      contextGeneration: envelope.contextGeneration,
      roleId: envelope.roleId,
      writingPolicyId: envelope.writingPolicyId,
      writingPolicyDocumentId: envelope.writingPolicyDocumentId,
      referenceInstruction: managedContextReferenceInstruction,
      document: {
        documentId: document.documentId,
        path: document.path,
        contentHash: document.contentHash,
        scope: document.scope,
        ...managedContextDocumentReferenceMetadata(document),
        content,
      },
    };
    items.push({
      type: "message",
      role: "developer",
      content: [{ type: "input_text", text: JSON.stringify(managedContext) }],
    });
  }
  return items;
}
