import { existsSync } from "node:fs";
import { isAbsolute, normalize, resolve, sep } from "node:path";

import { governingDocumentsFor } from "@lervo/repository-knowledge";

import { readGoverningIndex } from "./turn-governance.js";

const MAXIMUM_NAMED_PATHS = 32;
const PATH_TOKEN = /[A-Za-z0-9_.@-]+(?:\/[A-Za-z0-9_.@-]+)+\/?|[A-Za-z0-9_@-]+\.[A-Za-z0-9]{1,8}/gu;

/**
 * Repository paths a query sentence names, such as `apps/cli/src/query.ts` or `docs/`. Only paths
 * that exist in this checkout count, so free words never become targets.
 */
export function repositoryPathsNamedIn(root: string, text: string): string[] {
  const found = new Set<string>();
  for (const match of text.matchAll(PATH_TOKEN)) {
    if (found.size >= MAXIMUM_NAMED_PATHS) break;
    const candidate = match[0].replace(/[.,:;]+$/u, "").replace(/\/$/u, "");
    if (candidate === "" || isAbsolute(candidate)) continue;
    const relative = normalize(candidate);
    if (relative.startsWith("..") || relative.split(sep).includes("..")) continue;
    if (existsSync(resolve(root, relative))) found.add(relative.split(sep).join("/"));
  }
  return [...found];
}

/**
 * ADR-0556: canonical documents that name the target paths, weighted by how many they name. A
 * missing governing index prefers nothing, so the ranking stays as it was.
 */
export async function governingPreference(
  root: string,
  targetPaths: readonly string[],
): Promise<{ path: string; weight: number }[]> {
  if (targetPaths.length === 0) return [];
  const index = await readGoverningIndex(root).catch(() => null);
  if (index === null) return [];
  const counts = new Map<string, number>();
  for (const target of targetPaths)
    for (const document of governingDocumentsFor(index, target))
      counts.set(document, (counts.get(document) ?? 0) + 1);
  return [...counts].map(([path, weight]) => ({ path, weight }));
}
