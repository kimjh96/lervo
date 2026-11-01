import { stableId } from "./integrity.js";
import type { RepositoryKnowledgeScan, RepositorySource } from "./types.js";

export function repositorySourceCanEnterStructuralPublication(source: RepositorySource): boolean {
  return (
    source.agentArtifact?.contentHandling !== "local_inventory_only" &&
    source.kind !== "revision_metadata" &&
    source.kind !== "verification_result" &&
    source.kind !== "execution_event"
  );
}

/**
 * Binds Git-carried structural knowledge without allowing repository-local
 * provider configuration to change or fingerprint canonical publications.
 * Inner units are a deterministic function of the bytes each whole-file unit
 * version already binds, so only whole-file units enter the identity: an
 * observed-only source (ADR-0544) then fingerprints exactly as a retained one.
 */
export function repositoryKnowledgePublicationSnapshotId(scan: RepositoryKnowledgeScan): string {
  const sources = scan.sources
    .filter(repositorySourceCanEnterStructuralPublication)
    .map(({ content: _content, contentRetention: _retention, ...source }) => source);
  const sourceIds = new Set(sources.map((source) => source.sourceId));
  const unitVersionIds = scan.units
    .filter((unit) => sourceIds.has(unit.sourceId) && unit.unitKind === "file")
    .map((unit) => unit.unitVersionId);
  return stableId("ksnap", { sources, units: unitVersionIds });
}
