import { realpath } from "node:fs/promises";
import { resolve } from "node:path";

import {
  defaultNodeFleetRegistryPath,
  defaultRepositoryRegistryPath,
  listNodeFleetInstances,
  listRegisteredRepositories,
} from "@lervo/repository-registry";

/**
 * Every repository root this host knows: the host repository registry plus registered Nodes.
 * An unreadable or unresolvable registry contributes nothing; a vanished root is skipped.
 */
export async function hostRepositoryRoots(): Promise<string[]> {
  const roots = new Set<string>();
  // Path resolution can throw synchronously on an unsafe override.
  const registered = await Promise.resolve()
    .then(() => listRegisteredRepositories(defaultRepositoryRegistryPath()))
    .catch(() => []);
  for (const entry of registered) roots.add(entry.repositoryRoot);
  const nodes = await Promise.resolve()
    .then(() => listNodeFleetInstances(defaultNodeFleetRegistryPath()))
    .catch(() => []);
  for (const node of nodes) roots.add(node.repositoryRoot);
  const resolved = await Promise.all(
    [...roots].map((root) => realpath(resolve(root)).catch(() => null)),
  );
  return [...new Set(resolved.filter((root): root is string => root !== null))].sort();
}
