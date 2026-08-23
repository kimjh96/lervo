import {
  encodeTurnResultContent,
  inspectTurnResultBinding,
  type ProviderAdapter,
} from "@lervo/adapter-contract";
import type { ContextArtifactPort } from "@lervo/context-delivery";
import type { AdapterSession, AdapterTurn, AdapterTurnResult } from "@lervo/schemas";
import { validateSchema } from "@lervo/schemas";

import {
  ManagedProviderRunError,
  type ManagedProviderResultArtifact,
} from "./provider-run-types.js";

export async function collectProviderResult(input: {
  adapter: ProviderAdapter;
  session: AdapterSession;
  turn: AdapterTurn;
}): Promise<AdapterTurnResult> {
  const result = await input.adapter.getTurnResult(input.session, input.turn);
  if (!validateSchema("adapter", result).valid) {
    throw new ManagedProviderRunError(
      "contract_validation_failed",
      "The provider turn result does not satisfy the adapter schema.",
    );
  }
  const binding = inspectTurnResultBinding({
    session: input.session,
    turn: input.turn,
    result,
  });
  if (!binding.passed) {
    throw new ManagedProviderRunError(
      "contract_validation_failed",
      "The provider turn result coordinates or bytes differ from the common contract.",
    );
  }
  return structuredClone(result);
}

export async function storeProviderResult(input: {
  result: AdapterTurnResult;
  artifactStore: ContextArtifactPort;
}): Promise<ManagedProviderResultArtifact> {
  const bytes = encodeTurnResultContent(input.result.content);
  try {
    const stored = await input.artifactStore.put(bytes);
    const restored = new Uint8Array(await input.artifactStore.get(stored.uri));
    const expectedUri = `lervo-cas://sha256/${input.result.contentHash.slice(7)}`;
    if (
      stored.uri !== expectedUri ||
      stored.contentHash !== input.result.contentHash ||
      stored.byteCount !== input.result.byteCount ||
      restored.byteLength !== bytes.byteLength ||
      !Buffer.from(restored).equals(Buffer.from(bytes))
    ) {
      throw new Error("artifact verification failed");
    }
    return {
      artifactId: `art_${input.result.contentHash.slice(7)}`,
      uri: stored.uri,
      mediaType: input.result.mediaType,
      contentHash: input.result.contentHash,
      byteCount: input.result.byteCount,
    };
  } catch (error) {
    throw new ManagedProviderRunError(
      "artifact_storage_failed",
      "Could not store the provider result artifact safely.",
      { cause: error },
    );
  }
}
