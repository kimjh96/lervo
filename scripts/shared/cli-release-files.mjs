/** Exact allowlists; package metadata and archive inventory must agree with their manifest version. */
export const legacyCliReleaseFiles = Object.freeze([
  "README.md",
  "dist/bin.js",
  "dist/node-runtime.js",
  "dist/terminal-hook.js",
]);
export const legacyCliNativeFiles = Object.freeze([
  "dist/native/file-sync-darwin.node",
  "dist/native/file-sync.json",
]);
export const cliNativeFiles = Object.freeze(
  [...legacyCliNativeFiles, "dist/native/cas-io-darwin.node", "dist/native/cas-io.json"].sort(),
);
export const cliCasReleaseFiles = Object.freeze(
  [...legacyCliReleaseFiles, ...cliNativeFiles].sort(),
);
export const cliReleaseFiles = Object.freeze(
  [...cliCasReleaseFiles, "dist/repository-runtime.js"].sort(),
);

export const legacyCliGraphPackageFiles = Object.freeze(
  [
    ...cliReleaseFiles,
    "dist/repository-runtime.json",
    "dist/repository-runtime-*.js",
    "dist/repository-runtime-*.cjs",
  ].sort(),
);

export const cliGraphPackageFiles = Object.freeze(
  [...legacyCliGraphPackageFiles, "dist/terminal-hook-launcher.mjs"].sort(),
);

/**
 * The schema new manifests use. Schema 11 adds the repository LICENSE, which pnpm pack copies from
 * the workspace root into every package that has none of its own.
 */
export const currentCliReleaseSchemaVersion = 11;

export function cliReleaseFilesForSchema(
  schemaVersion,
  runtimeFiles = ["dist/repository-runtime.js"],
) {
  if (schemaVersion === 5) return legacyCliReleaseFiles;
  if (schemaVersion === 6) return [...legacyCliReleaseFiles, ...legacyCliNativeFiles].sort();
  if (schemaVersion === 7) return cliCasReleaseFiles;
  if (schemaVersion === 8) return cliReleaseFiles;
  if (schemaVersion >= 9 && schemaVersion <= 11)
    return [
      ...cliCasReleaseFiles,
      "dist/repository-runtime.json",
      ...runtimeFiles,
      ...(schemaVersion >= 10 ? ["dist/terminal-hook-launcher.mjs"] : []),
      ...(schemaVersion === 11 ? ["LICENSE"] : []),
    ].sort();
  return [];
}
