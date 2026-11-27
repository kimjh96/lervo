import { lstat } from "node:fs/promises";
import { resolve } from "node:path";

import type { DecisionTaxonomy } from "@lervo/project";

import { inspectGroupedDecisionPaths } from "./decision-layout.js";
import { sha256 } from "./integrity.js";
import type { RepositoryLayoutCandidates } from "./repository-layout-candidates.js";
import type { RepositoryLayoutMigrationPlan } from "./repository-layout-plan.js";
import { isWithinPublicationRoot } from "./repository-publication-files.js";
import { repositoryPathCanRemainIncluded } from "./scanner.js";
import type { RepositoryKnowledgePolicy, RepositoryKnowledgeScan } from "./types.js";

export async function repositoryPathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

/**
 * The plan's classification and grouped-decision blockers, then one blocker for every candidate
 * destination that is shared, occupied, excluded from the scan, or inside the publication root.
 */
export async function inspectRepositoryLayoutDestinations(input: {
  root: string;
  scan: RepositoryKnowledgeScan;
  policy: RepositoryKnowledgePolicy;
  taxonomy: DecisionTaxonomy;
  generatedPaths: ReadonlySet<string>;
  classified: RepositoryLayoutCandidates;
}): Promise<{
  blockers: RepositoryLayoutMigrationPlan["blockers"];
  blockedDestinations: Set<string>;
}> {
  const { root, scan, policy, taxonomy, generatedPaths, classified } = input;
  const candidates = classified.candidates;
  const repairableDecisionPaths = classified.repairableDecisionPaths;
  const destinationCounts = new Map<string, number>();
  for (const item of candidates)
    destinationCounts.set(item.toPath, (destinationCounts.get(item.toPath) ?? 0) + 1);
  const blockers: RepositoryLayoutMigrationPlan["blockers"] = [
    ...classified.blockers,
    ...inspectGroupedDecisionPaths(
      scan.sources.map((source) => source.path),
      taxonomy,
    )
      .filter(
        (blocker) =>
          blocker.code !== "unknown_decision_route" || !repairableDecisionPaths.has(blocker.path),
      )
      .map((blocker) => ({ ...blocker, pathDigest: sha256(blocker.path) })),
  ];
  const blockedDestinations = new Set<string>();
  for (const item of candidates) {
    if ((destinationCounts.get(item.toPath) ?? 0) > 1) {
      blockers.push({ code: "ambiguous_destination", pathDigest: sha256(item.toPath) });
      blockedDestinations.add(item.toPath);
    } else if (
      scan.sources.some((source) => source.path === item.toPath) ||
      generatedPaths.has(item.toPath) ||
      (await repositoryPathExists(resolve(root, item.toPath)))
    ) {
      blockers.push({ code: "destination_exists", pathDigest: sha256(item.toPath) });
      blockedDestinations.add(item.toPath);
    } else if (!repositoryPathCanRemainIncluded(item.toPath, policy)) {
      blockers.push({ code: "destination_exists", pathDigest: sha256(item.toPath) });
      blockedDestinations.add(item.toPath);
    } else if (isWithinPublicationRoot(item.toPath, policy.publicationRoot)) {
      // Git ignores the publication root, so a user document moved there leaves version control.
      blockers.push({
        code: "destination_in_publication_root",
        pathDigest: sha256(item.toPath),
        path: item.source.path,
      });
      blockedDestinations.add(item.toPath);
    }
  }
  return { blockers, blockedDestinations };
}
