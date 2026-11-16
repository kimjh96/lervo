const workspaceRangePattern = /^workspace:([*^~])$/u;
const dependencyFields = Object.freeze([
  "dependencies",
  "devDependencies",
  "optionalDependencies",
  "peerDependencies",
]);

function sortedValue(value) {
  if (Array.isArray(value)) return value.map(sortedValue);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, sortedValue(value[key])]),
  );
}

/** Key order is not part of a package manifest's meaning; pnpm does not keep it stable. */
export function canonicalPackageManifestJson(manifest) {
  return `${JSON.stringify(sortedValue(manifest))}\n`;
}

function resolveWorkspaceRange(name, range, workspaceVersions) {
  const match = typeof range === "string" ? workspaceRangePattern.exec(range) : null;
  if (match === null) return range;
  const version = workspaceVersions.get(name);
  // An unknown workspace package stays unresolved, so the comparison fails instead of guessing.
  if (typeof version !== "string") return range;
  return match[1] === "*" ? version : `${match[1]}${version}`;
}

/**
 * The manifest `pnpm pack` writes for a workspace package: the source manifest with each
 * `workspace:*`, `workspace:^`, or `workspace:~` range replaced by the workspace package's version.
 * Every other field, including scripts, bin, and dependencies, must come through unchanged.
 */
export function expectedPackedPackageManifest(sourceManifest, workspaceVersions) {
  const expected = { ...sourceManifest };
  for (const field of dependencyFields) {
    const dependencies = sourceManifest[field];
    if (dependencies === null || typeof dependencies !== "object") continue;
    expected[field] = Object.fromEntries(
      Object.entries(dependencies).map(([name, range]) => [
        name,
        resolveWorkspaceRange(name, range, workspaceVersions),
      ]),
    );
  }
  return expected;
}
