/** Generated tool caches are never repository source or managed change evidence. */
export const transientToolCacheDirectoryNames = Object.freeze([
  ".cache",
  ".mypy_cache",
  ".pytest_cache",
  ".ruff_cache",
  ".tox",
  ".nox",
  "__pycache__",
]);

const transientToolCacheNames = new Set<string>(transientToolCacheDirectoryNames);

export function isTransientToolCachePath(path: string): boolean {
  return path.split("/").some((segment) => transientToolCacheNames.has(segment));
}
