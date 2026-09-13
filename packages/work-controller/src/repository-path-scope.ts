function validPath(value: string): boolean {
  if (value === "." || value === "*") return true;
  return (
    value.length > 0 &&
    value.length <= 1024 &&
    !value.includes("\\") &&
    !value.includes("\0") &&
    !/^[A-Za-z]:/u.test(value) &&
    value.split("/").every((part) => part !== "" && part !== "." && part !== "..")
  );
}

/** Repository-root scopes cover normalized relative paths, never filesystem escapes. */
export function repositoryPathWithinScope(path: string, scope: string): boolean {
  return (
    validPath(path) &&
    validPath(scope) &&
    (scope === "." || scope === "*" || path === scope || path.startsWith(`${scope}/`))
  );
}

export function repositoryPathScopesOverlap(left: string, right: string): boolean {
  return repositoryPathWithinScope(left, right) || repositoryPathWithinScope(right, left);
}
