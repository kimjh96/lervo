const maximumChangedPaths = 20_000;

export function classifyCiChanges(paths, forceFull = false) {
  if (forceFull) return { coverage: "full", reason: "explicit_full_verification" };
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
