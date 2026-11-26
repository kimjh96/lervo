import { repositoryPathWithinScope } from "@lervo/work-controller";

/** The directories strictly between the repository root and `path`, deepest first. */
export function pathAncestors(path: string): string[] {
  const result: string[] = [];
  for (let index = path.lastIndexOf("/"); index > 0; index = path.lastIndexOf("/", index - 1))
    result.push(path.slice(0, index));
  return result;
}

/**
 * Scopes indexed once per call so each query costs the path's depth, not the number of scopes. It
 * answers exactly as `repositoryPathWithinScope` and `repositoryPathScopesOverlap` would against
 * every scope: `.` and `*` cover every valid path, and an invalid scope covers nothing.
 */
export class PathScopeIndex<T> {
  readonly #universal: T[] = [];
  readonly #exact = new Map<string, T[]>();
  /** Each proper ancestor of a scope, with the holders of the scopes below it. */
  readonly #below = new Map<string, T[]>();

  static of(scopes: Iterable<string>): PathScopeIndex<true> {
    const index = new PathScopeIndex<true>();
    for (const scope of scopes) index.add(scope, true);
    return index;
  }

  add(scope: string, holder: T): void {
    if (!repositoryPathWithinScope(scope, ".")) return;
    if (scope === "." || scope === "*") {
      this.#universal.push(holder);
      return;
    }
    append(this.#exact, scope, holder);
    for (const ancestor of pathAncestors(scope)) append(this.#below, ancestor, holder);
  }

  /** Whether a scope is the path or one of its ancestors. */
  covers(path: string): boolean {
    if (!repositoryPathWithinScope(path, ".")) return false;
    return (
      this.#universal.length !== 0 ||
      this.#exact.has(path) ||
      pathAncestors(path).some((ancestor) => this.#exact.has(ancestor))
    );
  }

  /** Whether a scope covers the path or lies below it. */
  overlaps(path: string): boolean {
    if (path === "." || path === "*") return this.#universal.length !== 0 || this.#exact.size !== 0;
    return this.covers(path) || this.#below.has(path);
  }

  /** The holders of every scope that overlaps the path, in insertion order per kind. */
  overlapping(path: string): T[] {
    if (!repositoryPathWithinScope(path, ".")) return [];
    if (path === "." || path === "*")
      return [...this.#universal, ...[...this.#exact.values()].flat()];
    return [
      ...this.#universal,
      ...(this.#exact.get(path) ?? []),
      ...pathAncestors(path).flatMap((ancestor) => this.#exact.get(ancestor) ?? []),
      ...(this.#below.get(path) ?? []),
    ];
  }
}

function append<T>(map: Map<string, T[]>, key: string, value: T): void {
  const values = map.get(key);
  if (values === undefined) map.set(key, [value]);
  else values.push(value);
}
