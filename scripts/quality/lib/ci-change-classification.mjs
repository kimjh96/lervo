const maximumChangedPaths = 20_000;

/**
 * ADR-0592: a pull request whose head carries pending release intent is verified in full by the
 * release preparation's dispatch for the exact prepared commit, so its own pull_request run keeps
 * only the quality checks.
 */
export function classifyCiChanges(paths, forceFull = false, releasePending = false) {
  if (forceFull) return { coverage: "full", reason: "explicit_full_verification" };
  if (releasePending)
    return { coverage: "release_pending", reason: "release_preparation_verifies" };
  if (!Array.isArray(paths) || paths.length === 0 || paths.length > maximumChangedPaths)
    return { coverage: "full", reason: "changed_paths_unknown" };
  const documentationOnly = paths.every(
    (path) =>
      typeof path === "string" &&
      /^docs\/(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_.-]+\.md$/u.test(path) &&
      !path.split("/").some((part) => ["test", "tests", "fixtures"].includes(part)),
  );
  return documentationOnly
    ? { coverage: "documentation_only", reason: "documentation_paths_only" }
    : { coverage: "full", reason: "code_or_unknown_path" };
}
