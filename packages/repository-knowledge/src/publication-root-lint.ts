import { lstat, readdir } from "node:fs/promises";
import { posix, resolve } from "node:path";

import type { KnowledgeLintIssue } from "./types.js";

const MAXIMUM_REPORTED_FILES = 32;
const MAXIMUM_VISITED_ENTRIES = 20_000;

/**
 * Reports files under the Git-ignored publication root that no recorded generation produced.
 * Such a file is outside version control and outside every generator's replacement rule, so it
 * survives refreshes but disappears from any other clone and from a rebuild.
 */
export async function lintPublicationRootResidents(input: {
  root: string;
  publicationRoot: string;
  generatedPaths: ReadonlySet<string>;
  issues: KnowledgeLintIssue[];
}): Promise<void> {
  const publicationRoot = input.publicationRoot.replace(/^\.\//u, "").replace(/\/+$/u, "");
  const pending = [publicationRoot];
  let visited = 0;
  let reported = 0;
  while (pending.length > 0) {
    const directory = pending.pop()!;
    let entries;
    try {
      entries = await readdir(resolve(input.root, directory), { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      visited += 1;
      if (visited > MAXIMUM_VISITED_ENTRIES) {
        input.issues.push({
          code: "publication_root_unmanaged_file",
          severity: "warning",
          path: publicationRoot,
          message: `The publication root exceeds ${MAXIMUM_VISITED_ENTRIES} entries; unmanaged files were not fully inspected.`,
        });
        return;
      }
      const path = posix.join(directory, entry.name);
      if (entry.isDirectory()) {
        pending.push(path);
        continue;
      }
      if (input.generatedPaths.has(path)) continue;
      const stats = await lstat(resolve(input.root, path)).catch(() => null);
      if (stats === null || stats.isDirectory()) continue;
      if (reported === MAXIMUM_REPORTED_FILES) return;
      reported += 1;
      input.issues.push({
        code: "publication_root_unmanaged_file",
        severity: "warning",
        path,
        message:
          "No recorded generation produced this file. Git ignores the publication root, so move any user content to a tracked path.",
      });
    }
  }
}
