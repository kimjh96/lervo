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
      "Provider turn result가 adapter schema를 통과하지 못했습니다.",
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
      "Provider turn result의 좌표 또는 bytes가 공통 계약과 다릅니다.",
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
      "Provider 결과 artifact를 안전하게 저장하지 못했습니다.",
      { cause: error },
    );
  }
}
