import { repositoryPathScopesOverlap, repositoryPathWithinScope } from "@lervo/work-controller";

/** The directories strictly between the repository root and `path`, deepest first. */
function ancestors(path: string): string[] {
  const parts = path.split("/");
  const result: string[] = [];
  for (let length = parts.length - 1; length >= 1; length -= 1)
    result.push(parts.slice(0, length).join("/"));
  return result;
}

function comparePaths(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/** The paths that no other path of the set covers, sorted: a lease never holds both a directory and a path below it. */
export function minimalPathCover(paths: Iterable<string>): string[] {
  const unique = new Set(paths);
  return [...unique]
    .filter((path) => !ancestors(path).some((ancestor) => unique.has(ancestor)))
    .sort(comparePaths);
}

/**
 * Lervo ADE coordination's last resort past a conversation's bound: the candidates are the
 * directories below the root that hold an entry. Take the deepest candidate that covers at least
 * two entries, overlaps no other holder, and stays inside the agent's responsibility, breaking ties
 * by path order; replace the entries below it with it; repeat until the set fits. Coalescing never
 * raises a candidate's count, so one pass in that order applies the rule exactly. Returns null when
 * no candidate makes the set fit.
 */
export function coalesceLeaseEntries(input: {
  entries: readonly string[];
  limit: number;
  heldPaths: readonly string[];
  responsibilityPaths: readonly string[];
}): string[] | null {
  const entries = new Set(minimalPathCover(input.entries));
  if (entries.size <= input.limit) return [...entries].sort(comparePaths);
  const below = new Map<string, Set<string>>();
  for (const entry of entries)
    for (const ancestor of ancestors(entry)) {
      const held = below.get(ancestor) ?? new Set<string>();
      held.add(entry);
      below.set(ancestor, held);
    }
  const candidates = [...below.keys()].sort(
    (left, right) => right.split("/").length - left.split("/").length || comparePaths(left, right),
  );
  for (const candidate of candidates) {
    if (entries.size <= input.limit) break;
    const covered = below.get(candidate)!;
    if (
      covered.size < 2 ||
      !input.responsibilityPaths.some((scope) => repositoryPathWithinScope(candidate, scope)) ||
      input.heldPaths.some((held) => repositoryPathScopesOverlap(candidate, held))
    )
      continue;
    for (const entry of [...covered]) {
      entries.delete(entry);
      for (const ancestor of ancestors(entry)) below.get(ancestor)!.delete(entry);
    }
    entries.add(candidate);
    for (const ancestor of ancestors(candidate)) below.get(ancestor)!.add(candidate);
  }
  return entries.size <= input.limit ? [...entries].sort(comparePaths) : null;
}
