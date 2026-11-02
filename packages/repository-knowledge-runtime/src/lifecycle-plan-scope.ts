import { pathWithinConvergenceRoots } from "./delegation.js";
import { convergenceManagedKnowledgePath } from "./managed-knowledge-scope.js";

type LifecycleOperations = {
  operations: ReadonlyArray<{ path: string; action: string; destinationPath?: string }>;
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
