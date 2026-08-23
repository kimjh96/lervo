import type { KnowledgeCandidate } from "@lervo/schemas";

import { knowledgeCandidateBytes, knowledgeSha256 } from "./integrity.js";
import { type CreateKnowledgeCandidatesInput, KnowledgeError } from "./types.js";

export async function storeCandidate(
  input: CreateKnowledgeCandidatesInput,
  candidate: KnowledgeCandidate,
) {
  const bytes = knowledgeCandidateBytes(candidate);
  let stored;
  try {
    stored = await input.artifactStore.put(bytes);
    const reloaded = await input.artifactStore.get(stored.uri);
    if (
      stored.contentHash !== knowledgeSha256(bytes) ||
      stored.byteCount !== bytes.byteLength ||
      knowledgeSha256(reloaded) !== stored.contentHash ||
      !Buffer.from(reloaded).equals(Buffer.from(bytes))
    ) throw new Error("candidate CAS mismatch");
  } catch (error) {
    throw new KnowledgeError(
      "artifact_storage_failed",
      "candidate_artifact_mismatch",
      "Could not store and reverify the knowledge candidate source in CAS.",
      { cause: error },
    );
  }
  return {
    artifactId: `art_${stored.contentHash.slice(7)}`,
    uri: stored.uri,
    mediaType: "application/vnd.lervo.knowledge-candidate+json; charset=utf-8" as const,
    contentHash: stored.contentHash,
    byteCount: stored.byteCount,
  };
}
