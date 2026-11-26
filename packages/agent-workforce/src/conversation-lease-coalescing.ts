import { PathScopeIndex, pathAncestors } from "./path-scope-index.js";

function comparePaths(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/** The paths that no other path of the set covers, sorted: a lease never holds both a directory and a path below it. */
export function minimalPathCover(paths: Iterable<string>): string[] {
  const unique = new Set(paths);
  return [...unique]
    .filter((path) => !pathAncestors(path).some((ancestor) => unique.has(ancestor)))
    .sort(comparePaths);
}

/**
 * Lervo ADE coordination's last resort past a conversation's bound: the candidates are the
 * directories below the root that hold an entry. Take the deepest candidate that covers at least
 * two entries, overlaps no other holder, and stays inside the agent's responsibility, breaking ties
 * by path order; replace the entries below it with it; repeat until the set fits. Coalescing never
 * raises a candidate's count, so one pass in that order applies the rule exactly, in time linear in
 * the entries times their depth. Returns null when no candidate makes the set fit.
 */
export function coalesceLeaseEntries(input: {
  entries: Iterable<string>;
  limit: number;
  isHeld: (path: string) => boolean;
  responsibilityPaths: readonly string[];
}): string[] | null {
  const entries = new Set(minimalPathCover(input.entries));
  if (entries.size <= input.limit) return [...entries].sort(comparePaths);
  const below = new Map<string, Set<string>>();
  for (const entry of entries)
    for (const ancestor of pathAncestors(entry)) {
      const held = below.get(ancestor);
      if (held === undefined) below.set(ancestor, new Set([entry]));
      else held.add(entry);
    }
  const responsibility = PathScopeIndex.of(input.responsibilityPaths);
  const candidates = [...below.keys()]
    .map((path) => ({ path, depth: pathAncestors(path).length }))
    .sort((left, right) => right.depth - left.depth || comparePaths(left.path, right.path));
  for (const { path: candidate } of candidates) {
    if (entries.size <= input.limit) break;
    const covered = below.get(candidate)!;
    if (covered.size < 2 || !responsibility.covers(candidate) || input.isHeld(candidate)) continue;
    for (const entry of [...covered]) {
      entries.delete(entry);
      for (const ancestor of pathAncestors(entry)) below.get(ancestor)!.delete(entry);
    }
    entries.add(candidate);
    for (const ancestor of pathAncestors(candidate)) below.get(ancestor)!.add(candidate);
  }
  return entries.size <= input.limit ? [...entries].sort(comparePaths) : null;
}
