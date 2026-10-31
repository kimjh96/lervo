import { stableId, type RepositoryLayoutMigrationPlan } from "@lervo/repository-knowledge";
import { pathWithinConvergenceRoots } from "./delegation.js";
import { convergenceManagedKnowledgePath } from "./managed-knowledge-scope.js";

type LifecycleOperations = { operations: RepositoryLayoutMigrationPlan["operations"] };

export function lifecycleChangedPaths(plan: LifecycleOperations): string[] {
  return [
    ...new Set(
      plan.operations
        .filter((operation) => operation.action !== "unchanged")
        .flatMap((operation) =>
          "destinationPath" in operation
            ? [operation.path, operation.destinationPath]
            : [operation.path],
        ),
    ),
  ].sort();
}

/** The exact plan is atomic; reference rewrites and destinations require the same authority. */
export function missingLifecyclePaths(
  plan: LifecycleOperations,
  roots: readonly string[],
): string[] {
  return missingConvergencePaths(lifecycleChangedPaths(plan), roots);
}

export function missingConvergencePaths(paths: string[], roots: readonly string[]): string[] {
  return paths.filter(
    (path) =>
      !convergenceManagedKnowledgePath(path) && !pathWithinConvergenceRoots(path, [...roots]),
  );
}

/** A deferred projection is observation only. It must never be reviewed or applied. */
export function deferLayoutOutsideScope(
  plan: RepositoryLayoutMigrationPlan,
  requiredPaths: string[],
): RepositoryLayoutMigrationPlan {
  const deferredDocuments = [
    ...plan.deferredDocuments,
    ...plan.moves.map((move) => ({
      classificationId:
        move.semanticClassification?.classificationId ??
        stableId("kdroute", [move.fromPath, move.contentHash, move.toPath]),
      subject:
        move.classification === "decision"
          ? ("decision" as const)
          : move.classification === "instruction"
            ? ("instruction" as const)
            : ("document" as const),
      path: move.fromPath,
      contentHash: move.contentHash,
      workspacePackage: null,
      reason: "delegation_scope" as const,
      resolution: "delegation_scope" as const,
      basis: move.classificationBasis ?? move.reason,
      destination: move.toPath,
      requiredPaths,
    })),
  ].sort((a, b) => a.path.localeCompare(b.path));
  return {
    ...plan,
    planId: stableId("klayout", [plan.planId, requiredPaths]),
    status: plan.status === "blocked" ? "blocked" : "current",
    coverage: { ...plan.coverage, complete: false },
    moves: [],
    userUpdates: [],
    machineMoves: [],
    referenceUpdates: [],
    operations: [],
    deferredDocuments,
    deferredDocumentCount: deferredDocuments.length,
  };
}
