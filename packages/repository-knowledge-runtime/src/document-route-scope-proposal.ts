import { lstat } from "node:fs/promises";
import { resolve } from "node:path";
import {
  createRepositoryLayoutMigrationPlan,
  stableId,
  type RepositoryLayoutMigrationPlan,
} from "@lervo/repository-knowledge";

import { type ConvergenceDelegation } from "./delegation.js";
import { missingLifecyclePaths } from "./lifecycle-plan-scope.js";
import { convergenceDelegationScopeHash } from "./delegation-scope.js";

type SemanticMove = RepositoryLayoutMigrationPlan["moves"][number];
export interface DocumentRouteScopeProposal {
  proposalId: string;
  recommendation: "accept";
  /** Scope remains owner-reviewed; the existing delegation contract admits at most 32 roots. */
  acceptanceBlocker: "normalization_root_limit" | "scope_path_unavailable" | null;
  /** Exactly the missing paths needed by this atomic lifecycle plan. */
  requiredPaths: string[];
  unsatisfiedPaths: string[];
  planId: string;
  paths: Array<{
    path: string;
    classification: SemanticMove["classification"];
    destination: string;
    evidence: NonNullable<SemanticMove["semanticClassification"]>;
  }>;
}

/** One current scope decision, rebuilt from exact semantic moves, never from pending guesses. */
export async function proposeDocumentRouteScope(input: {
  repositoryRoot: string;
  delegation: ConvergenceDelegation;
  layout?: RepositoryLayoutMigrationPlan;
}): Promise<DocumentRouteScopeProposal | null> {
  const { delegation } = input;
  if (delegation.state !== "active") return null;
  const layout =
    input.layout ??
    (await createRepositoryLayoutMigrationPlan({ repositoryRoot: input.repositoryRoot }));
  const requiredPaths = missingLifecyclePaths(layout, [
    ...delegation.canonicalRoots,
    ...delegation.normalizationRoots,
  ]);
  if (requiredPaths.length === 0) return null;
  const retained = new Set(layout.retainedDocuments.map((document) => document.path));
  const paths: DocumentRouteScopeProposal["paths"] = [];
  for (const move of layout.moves) {
    if (
      move.classificationBasis !== "semantic_provider" ||
      move.semanticClassification === undefined ||
      retained.has(move.fromPath)
    )
      continue;
    paths.push({
      path: move.fromPath,
      classification: move.classification,
      destination: move.toPath,
      evidence: move.semanticClassification,
    });
  }
  paths.sort((a, b) => a.path.localeCompare(b.path));
  const unsatisfiedPaths: string[] = [];
  for (const path of requiredPaths) {
    try {
      const stat = await lstat(resolve(input.repositoryRoot, path));
      if (!stat.isFile() || stat.isSymbolicLink() || retained.has(path))
        unsatisfiedPaths.push(path);
    } catch (error) {
      // A new destination is an exact file path even though its bytes do not exist yet.
      if (
        (error as NodeJS.ErrnoException).code !== "ENOENT" ||
        !layout.operations.some(
          (operation) =>
            ("destinationPath" in operation && operation.destinationPath === path) ||
            (operation.path === path && operation.action === "create"),
        )
      )
        unsatisfiedPaths.push(path);
    }
  }
  return paths.length === 0
    ? null
    : {
        proposalId: stableId("kdscope", {
          scopeHash: convergenceDelegationScopeHash(delegation),
          paths,
          requiredPaths,
          unsatisfiedPaths,
          // Bind references and all required source bytes; expiry-only renewals preserve identity.
          operations: layout.operations,
        }),
        recommendation: "accept",
        planId: layout.planId,
        requiredPaths: requiredPaths.filter((path) => !unsatisfiedPaths.includes(path)),
        unsatisfiedPaths,
        acceptanceBlocker:
          unsatisfiedPaths.length > 0
            ? "scope_path_unavailable"
            : delegation.normalizationRoots.length + requiredPaths.length > 32
              ? "normalization_root_limit"
              : null,
        paths,
      };
}
