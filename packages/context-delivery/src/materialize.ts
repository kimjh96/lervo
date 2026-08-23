import {
  type AdapterContextEnvelope,
  cloneContextScope,
} from "@lervo/schemas";
import type { LoadedContext } from "@lervo/context";

import { createInlineThresholdPolicy } from "./delivery-policy.js";
import {
  ContextDeliveryError,
  type ContextArtifactPort,
  type ContextDeliveryKind,
  type ContextDeliveryOptions,
} from "./types.js";
import { hashBytes } from "./validation.js";

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
  artifactStore: ContextArtifactPort,
): Promise<{ kind: "cas"; uri: string }> {
  try {
    const result = await artifactStore.put(bytes);
    const stored = await artifactStore.get(result.uri);
    const expectedUri = `lervo-cas://sha256/${expectedHash.slice("sha256:".length)}`;
    if (
      result.uri !== expectedUri ||
      result.contentHash !== expectedHash ||
      result.byteCount !== bytes.byteLength ||
      hashBytes(stored) !== expectedHash ||
      stored.byteLength !== bytes.byteLength
    ) {
      throw new ContextDeliveryError(
        "artifact_storage_failed",
        `CAS verification failed: ${documentId}`,
      );
    }
    return { kind: "cas", uri: result.uri };
  } catch (error) {
    if (error instanceof ContextDeliveryError) throw error;
    throw new ContextDeliveryError(
      "artifact_storage_failed",
      `Could not store the context document safely in CAS: ${documentId}`,
      { cause: error },
    );
  }
}

export async function materializeContextDocuments(input: {
  loaded: LoadedContext;
  options: ContextDeliveryOptions;
}): Promise<AdapterContextEnvelope["documents"]> {
  const deliveryPolicy = input.options.deliveryPolicy ?? createInlineThresholdPolicy();
  const loadedById = new Map(
    input.loaded.documents.map((document) => [document.documentId, document]),
  );
  const snapshots = input.loaded.plan.documents.map((planned) => {
    const document = loadedById.get(planned.documentId)!;
    return {
      documentId: document.documentId,
      path: document.path,
      contentHash: document.contentHash,
      byteCount: document.byteCount,
      scope: cloneContextScope(document.scope),
      sharedContextIds: [...document.sharedContextIds],
      ...(document.knowledgeContext === undefined
        ? {}
        : { knowledgeContext: structuredClone(document.knowledgeContext) }),
      bytes: Uint8Array.from(document.bytes),
    };
  });
  return Promise.all(
    snapshots.map(async (snapshot) => {
      const bytes = snapshot.bytes;
      const inline = decodeInline(bytes);
      let deliveryKind: ContextDeliveryKind;
      try {
        deliveryKind = deliveryPolicy({
          documentId: snapshot.documentId,
          path: snapshot.path,
          contentHash: snapshot.contentHash,
          byteCount: snapshot.byteCount,
          scope: cloneContextScope(snapshot.scope),
          sharedContextIds: [...snapshot.sharedContextIds],
          inlineContentAvailable: inline !== null,
        });
      } catch (error) {
        if (error instanceof ContextDeliveryError) throw error;
        throw new ContextDeliveryError(
          "invalid_delivery_request",
          `Delivery policy execution failed: ${snapshot.documentId}`,
        );
      }
      let delivery: { kind: "inline"; content: string } | { kind: "cas"; uri: string };
      if (deliveryKind === "inline") {
        if (inline === null) {
          throw new ContextDeliveryError(
            "invalid_inline_content",
            `The document cannot be delivered losslessly as UTF-8: ${snapshot.documentId}`,
          );
        }
        delivery = { kind: "inline", content: inline };
      } else if (deliveryKind === "cas") {
        if (input.options.artifactStore === undefined) {
          throw new ContextDeliveryError(
            "artifact_store_required",
            `CAS delivery requires an artifact port: ${snapshot.documentId}`,
          );
        }
        delivery = await storeInCas(
          snapshot.documentId,
          bytes,
          snapshot.contentHash,
          input.options.artifactStore,
        );
      } else {
        throw new ContextDeliveryError(
          "invalid_delivery_request",
          `The delivery policy returned an unsupported result: ${snapshot.documentId}`,
        );
      }
      return {
        documentId: snapshot.documentId,
        path: snapshot.path,
        contentHash: snapshot.contentHash,
        byteCount: snapshot.byteCount,
        scope: cloneContextScope(snapshot.scope),
        ...(snapshot.knowledgeContext === undefined
          ? {}
          : { knowledgeContext: structuredClone(snapshot.knowledgeContext) }),
        delivery,
      };
    }),
  );
}
