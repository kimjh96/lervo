import { pathWithinConvergenceRoots } from "./delegation.js";
import { convergenceManagedKnowledgePath } from "./managed-knowledge-scope.js";

type LifecycleOperations = {
  operations: ReadonlyArray<{
    path: string;
    action: string;
    destinationPath?: string;
    ownership?: string;
  }>;
};

export function lifecycleChangedPaths(plan: LifecycleOperations): string[] {
  return [
    ...new Set(
      plan.operations
        .filter((operation) => operation.action !== "unchanged")
        .flatMap((operation) =>
          operation.destinationPath === undefined
            ? [operation.path]
            : [operation.path, operation.destinationPath],
        ),
    ),
  ].sort();
}

/** The exact plan is atomic: every path it changes outside the given roots, destinations included. */
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

/**
 * AGENTS.md invariant 5: the paths whose user-owned bytes a plan overwrites. A user file it
 * updates or deletes, and a moved document whose bytes it rewrites, count; a user file it creates
 * where none existed, a byte-preserving move, a Lervo-generated file, and a Lervo-managed block do
 * not.
 */
export function lifecycleUserContentPaths(plan: LifecycleOperations): string[] {
  return [
    ...new Set(
      plan.operations
        .filter(
          (operation) =>
            (operation.ownership === "user" &&
              operation.action !== "unchanged" &&
              operation.action !== "create") ||
            operation.action === "move_update",
        )
        .flatMap((operation) =>
          operation.destinationPath === undefined
            ? [operation.path]
            : [operation.path, operation.destinationPath],
        ),
    ),
  ].sort();
}

/**
 * ADR-0561 with invariant 5: user-owned bytes a reviewed plan would rewrite outside the roots the
 * owner delegated. Lervo never applies such a plan on its own.
 */
export function userContentOutsideRoots(
  plan: LifecycleOperations,
  roots: readonly string[],
): string[] {
  return missingConvergencePaths(lifecycleUserContentPaths(plan), roots);
}
