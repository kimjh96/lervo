import type { RepositorySnapshot } from "./repository-snapshot.js";
import type { ManagedFileChangeEvidence } from "./types.js";

export function changedRepositoryPaths(
  before: RepositorySnapshot,
  after: RepositorySnapshot,
): string[] {
  const paths = new Set([...Object.keys(before.files), ...Object.keys(after.files)]);
  return [...paths].filter((path) => before.files[path] !== after.files[path]).sort();
}

export interface ManagedRepositoryChangeInspection {
  changedPaths: string[];
  verifiedManagedPaths: string[];
  invalidManagedPaths: string[];
  unmanagedPaths: string[];
}

export function inspectManagedRepositoryChanges(input: {
  before: RepositorySnapshot;
  after: RepositorySnapshot;
  managedChanges: readonly ManagedFileChangeEvidence[];
}): ManagedRepositoryChangeInspection {
  const changedPaths = changedRepositoryPaths(input.before, input.after);
  const verifiedManagedPaths = new Set<string>();
  const invalidManagedPaths = new Set<string>();
  for (const change of input.managedChanges) {
    const beforeHash = input.before.files[change.path] ?? null;
    const afterHash = input.after.files[change.path] ?? null;
    if (
      verifiedManagedPaths.has(change.path) ||
      beforeHash !== change.beforeHash ||
      afterHash !== change.afterHash ||
      !changedPaths.includes(change.path)
    ) {
      invalidManagedPaths.add(change.path);
    } else {
      verifiedManagedPaths.add(change.path);
    }
  }
  return {
    changedPaths,
    verifiedManagedPaths: [...verifiedManagedPaths].sort(),
    invalidManagedPaths: [...invalidManagedPaths].sort(),
    unmanagedPaths: changedPaths.filter(
      (path) => !verifiedManagedPaths.has(path) || invalidManagedPaths.has(path),
    ),
  };
}
