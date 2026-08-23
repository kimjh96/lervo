import type { ArtifactStore } from "@lervo/storage-contract";

import { knowledgeSha256 } from "./integrity.js";
import { KnowledgeError, type KnowledgeArtifactCoordinate } from "./types.js";

export async function storeKnowledgeArtifact(input: {
  artifactStore: ArtifactStore;
  bytes: Uint8Array;
  mismatchReason:
    | "approval_artifact_mismatch"
    | "knowledge_artifact_mismatch"
    | "staleness_artifact_mismatch";
  label: string;
}): Promise<KnowledgeArtifactCoordinate> {
  try {
    const stored = await input.artifactStore.put(input.bytes);
    const reloaded = await input.artifactStore.get(stored.uri);
    if (
      stored.contentHash !== knowledgeSha256(input.bytes) ||
      stored.byteCount !== input.bytes.byteLength ||
      knowledgeSha256(reloaded) !== stored.contentHash ||
      !Buffer.from(reloaded).equals(Buffer.from(input.bytes))
    ) throw new Error(`${input.label} CAS mismatch`);
    return {
      artifactId: `art_${stored.contentHash.slice(7)}`,
      uri: stored.uri,
      contentHash: stored.contentHash,
      byteCount: stored.byteCount,
    };
  } catch (error) {
    throw new KnowledgeError(
      "artifact_storage_failed",
      input.mismatchReason,
      `Could not store and reverify the ${input.label} source in CAS.`,
      { cause: error },
    );
  }
}
