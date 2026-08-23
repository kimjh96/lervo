import { stableId } from "./integrity.js";
import type { RepositoryKnowledgeScan, RepositorySource } from "./types.js";

export function repositorySourceCanEnterStructuralPublication(source: RepositorySource): boolean {
  return source.agentArtifact?.contentHandling !== "local_inventory_only";
}

/**
 * Binds Git-carried structural knowledge without allowing repository-local
 * provider configuration to change or fingerprint canonical publications.
 */
export function repositoryKnowledgePublicationSnapshotId(scan: RepositoryKnowledgeScan): string {
  const sources = scan.sources
    .filter(repositorySourceCanEnterStructuralPublication)
    .filter((source) => source.kind !== "revision_metadata" && source.kind !== "verification_result" && source.kind !== "execution_event")
    .map(({ content: _content, ...source }) => source);
  const sourceIds = new Set(sources.map((source) => source.sourceId));
  const unitVersionIds = scan.units
    .filter((unit) => sourceIds.has(unit.sourceId) && unit.unitKind !== "revision" && unit.unitKind !== "verification" && unit.unitKind !== "event")
    .map((unit) => unit.unitVersionId);
  return stableId("ksnap", { sources, units: unitVersionIds });
}
