import { readdir, realpath, rm } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";

import type { HostActivationRecord } from "./host-cli-activation.js";
import type { HostUpgradeLayout } from "./host-upgrade-layout.js";

/**
 * ADR-0571 retention: kept downloads and installs live only while a retained activation, an
 * executable link, or ADR-0488's `current` pointer references them. Only directory names this
 * layout creates are removed, and staging directories only while the host upgrade lock is held.
 */
const installDirectoryPattern = /^\d+\.\d+\.\d+-[a-f0-9]{12}$/u;
const downloadDirectoryPattern = /^v\d+\.\d+\.\d+-[a-f0-9]{12}$/u;
const stagingDirectoryPattern = /^\.staging-/u;

/**
 * Both spellings of each parent: link targets and the `current` pointer are physical paths, while
 * the layout may be reached through a symbolic link such as a linked home directory.
 */
async function parentSpellings(parent: string): Promise<string[]> {
  const physical = await realpath(parent).catch(() => parent);
  return physical === parent ? [parent] : [parent, physical];
}

function childOf(parent: string, path: string): string | null {
  const inner = relative(parent, path);
  if (inner === "" || inner === ".." || inner.startsWith(`..${sep}`) || isAbsolute(inner))
    return null;
  return inner.split(sep)[0] ?? null;
}

/** The layout's own release directories that the given paths lie in. */
export async function referencedReleaseDirectories(
  layout: HostUpgradeLayout,
  paths: readonly (string | null)[],
): Promise<Set<string>> {
  const parents = [
    [layout.installsDirectory, await parentSpellings(layout.installsDirectory)],
    [layout.downloadsDirectory, await parentSpellings(layout.downloadsDirectory)],
  ] as const;
  const referenced = new Set<string>();
  for (const path of paths) {
    if (path === null) continue;
    for (const [parent, spellings] of parents)
      for (const spelling of spellings) {
        const child = childOf(spelling, path);
        if (child !== null) referenced.add(resolve(parent, child));
      }
  }
  return referenced;
}

/** Every path a retained activation needs to stay usable, including for its rollback. */
export function activationReferences(journal: readonly HostActivationRecord[]): string[] {
  const paths: string[] = [];
  for (const record of journal) {
    if (record.release !== undefined)
      paths.push(record.release.installDirectory, record.release.downloadDirectory);
    for (const link of record.links)
      for (const target of [link.previous, link.current]) if (target !== null) paths.push(target);
  }
  return paths;
}

/** Removes unreferenced release directories and leftover staging; call only under the lock. */
export async function pruneHostReleases(
  layout: HostUpgradeLayout,
  referenced: ReadonlySet<string>,
): Promise<string[]> {
  const removed: string[] = [];
  const prune = async (directory: string, pattern: RegExp) => {
    const names = await readdir(directory).catch(() => [] as string[]);
    for (const name of names) {
      const path = resolve(directory, name);
      const staging = stagingDirectoryPattern.test(name);
      if ((!pattern.test(name) && !staging) || referenced.has(path)) continue;
      await rm(path, { recursive: true, force: true });
      if (!staging) removed.push(path);
    }
  };
  await prune(layout.installsDirectory, installDirectoryPattern);
  await prune(layout.downloadsDirectory, downloadDirectoryPattern);
  return removed;
}
