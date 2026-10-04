import type { ArtifactStore } from "@lervo/storage-contract";

import { readWritingArtifact } from "./artifact.js";
import {
  enforceProviderClaim,
  type ProviderClaimContext,
  type ProviderClaimResult,
} from "./provider-claim.js";
import type { WritingArtifactCoordinate } from "./types.js";

/**
 * Applies `provider_claim_unproven` to a stored writing artifact before publication. A repaired
 * reply becomes a new content-addressed artifact; the original stays recoverable by its hash.
 */
export async function repairProviderClaimArtifact(input: {
  artifactStore: ArtifactStore;
  artifact: WritingArtifactCoordinate;
  context: ProviderClaimContext;
}): Promise<{ artifact: WritingArtifactCoordinate; result: ProviderClaimResult }> {
  const content = await readWritingArtifact(input.artifactStore, input.artifact);
  const result = await enforceProviderClaim(content, input.context);
  if (result.disposition !== "repaired") return { artifact: input.artifact, result };
  const stored = await input.artifactStore.put(Buffer.from(result.content, "utf8"));
  return {
    artifact: {
      artifactId: `art_${stored.contentHash.slice("sha256:".length)}`,
      uri: stored.uri,
      mediaType: "text/markdown; charset=utf-8",
      contentHash: stored.contentHash,
      byteCount: stored.byteCount,
    },
    result,
  };
}
