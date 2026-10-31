import { assertManagedRepositoryKnowledgeCurrent } from "@lervo/managed-provider-host";
import { lintRepositoryKnowledge } from "@lervo/repository-knowledge";
import type { ArtifactStore } from "@lervo/storage-contract";

import { resolveConversationRepositoryWorkKnowledgeDisposition } from "./conversation-repository-work-knowledge.js";
import type { RepositoryWorkChange } from "./repository-work-observation.js";
import {
  assertPreparedRepositoryWorkSourceManifest,
  type PreparedRepositoryWorkSourceManifest,
} from "./repository-work-source-manifest.js";

/** Prepares the exact knowledge claim without allowing an async claim to run a global scan. */
export async function prepareConversationRepositoryWorkKnowledgeEvidence(input: {
  repositoryRoot: string;
  artifacts: ArtifactStore;
  baselineKnowledgeCurrent: boolean;
  repositoryChange: RepositoryWorkChange;
  mode: "synchronous" | "pending_background";
  sourceManifest?: PreparedRepositoryWorkSourceManifest;
}): Promise<{
  disposition: "current" | "baseline_valid" | "pending_background" | "not_applicable";
  sourceManifestArtifact: { contentHash: string; byteCount: number } | null;
}> {
  if (input.mode === "synchronous") {
    if (input.sourceManifest !== undefined) {
      throw new Error("Synchronous completion must not attach an unreviewed source manifest.");
    }
    return {
      disposition: await resolveConversationRepositoryWorkKnowledgeDisposition({
        changedPathCount: input.repositoryChange.changedPaths.length,
        baselineKnowledgeCurrent: input.baselineKnowledgeCurrent,
        assertCurrent: () => assertManagedRepositoryKnowledgeCurrent(input.repositoryRoot),
        lintReport: () => lintRepositoryKnowledge(input.repositoryRoot),
      }),
      sourceManifestArtifact: null,
    };
  }
  if (input.repositoryChange.changedPaths.length === 0) {
    if (input.sourceManifest !== undefined) {
      throw new Error("Unchanged repository work must not claim a changed-source manifest.");
    }
    return { disposition: "not_applicable", sourceManifestArtifact: null };
  }
  if (input.sourceManifest === undefined) {
    throw new Error("Changed repository work has no exact source manifest for background review.");
  }
  assertPreparedRepositoryWorkSourceManifest({
    prepared: input.sourceManifest,
    change: input.repositoryChange,
  });
  const artifact = await input.artifacts.put(input.sourceManifest.content);
  if (
    artifact.contentHash !== input.sourceManifest.contentHash ||
    artifact.byteCount !== input.sourceManifest.content.byteLength
  ) {
    throw new Error("The stored source manifest differs from the observed repository change.");
  }
  return {
    disposition: "pending_background",
    sourceManifestArtifact: { contentHash: artifact.contentHash, byteCount: artifact.byteCount },
  };
}
