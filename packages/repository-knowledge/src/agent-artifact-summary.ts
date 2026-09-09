import type {
  KnowledgeMigrationPlan,
  RepositoryAgentArtifact,
  RepositoryKnowledgeScan,
} from "./types.js";

const reviewDispositions = new Set<RepositoryAgentArtifact["migrationDisposition"]>([
  "portable_skill_review",
  "workflow_review",
  "provider_specific_review",
]);

export function summarizeRepositoryAgentArtifacts(
  scan: RepositoryKnowledgeScan,
): KnowledgeMigrationPlan["agentArtifacts"] {
  const items = scan.sources
    .flatMap((source) =>
      source.agentArtifact === undefined
        ? []
        : [
            {
              path: source.path,
              status: source.status,
              classification: source.classification,
              ...source.agentArtifact,
            },
          ],
    )
    .sort((left, right) => left.path.localeCompare(right.path));
  const byRole: KnowledgeMigrationPlan["agentArtifacts"]["byRole"] = {};
  for (const item of items) byRole[item.role] = (byRole[item.role] ?? 0) + 1;
  return {
    total: items.length,
    semanticSources: items.filter(
      (item) => item.contentHandling === "semantic_source" && item.status === "included",
    ).length,
    localInventoryOnly: items.filter((item) => item.contentHandling === "local_inventory_only")
      .length,
    reviewRequired: items.filter((item) => reviewDispositions.has(item.migrationDisposition))
      .length,
    nonstandard: items.filter(
      (item) => item.discovery === "not_standard" || item.discovery === "not_current_standard",
    ).length,
    byRole,
    items,
  };
}
