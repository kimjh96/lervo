import { lstat } from "node:fs/promises";
import { resolve } from "node:path";

import { lervoRelativePaths } from "@lervo/project";

import { legacyStructuralManifestPath, structuralManifestPath } from "./structural-projection.js";
import type { KnowledgeMigrationPlan } from "./types.js";

/**
 * Whether this checkout holds an applied structural generation. Git ignores every generated
 * output, so a fresh clone starts without one even when the repository is fully initialized.
 */
export async function repositoryKnowledgeBuilt(repositoryRoot: string): Promise<boolean> {
  for (const path of [structuralManifestPath, legacyStructuralManifestPath]) {
    const stats = await lstat(resolve(repositoryRoot, path)).catch(() => null);
    if (stats?.isFile() === true && !stats.isSymbolicLink()) return true;
  }
  return false;
}

/**
 * Whether applying the plan would write only rebuildable, Git-ignored projections: local knowledge
 * state and pages under the publication root. Any tracked path, such as `.gitignore`,
 * `AGENTS.md`, or a user document, needs a person to review the plan instead.
 */
export function migrationPlanWritesOnlyRebuildableProjections(
  plan: Pick<KnowledgeMigrationPlan, "status" | "operations">,
  publicationRoot: string,
): boolean {
  if (plan.status !== "ready") return false;
  const roots = [
    `${lervoRelativePaths.knowledgeState}/`,
    `${publicationRoot.replace(/^\.\//u, "").replace(/\/+$/u, "")}/`,
  ];
  return plan.operations.every(
    (operation) =>
      operation.action === "unchanged" ||
      (operation.action !== "conflict" &&
        operation.ownership === "lervo_generated" &&
        roots.some((root) => operation.path.startsWith(root))),
  );
}
