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

export const cliGraphPackageFiles = Object.freeze(
  [
    ...cliReleaseFiles,
    "dist/repository-runtime.json",
    "dist/repository-runtime-*.js",
    "dist/repository-runtime-*.cjs",
  ].sort(),
);

export function cliReleaseFilesForSchema(
  schemaVersion,
  runtimeFiles = ["dist/repository-runtime.js"],
) {
  if (schemaVersion === 5) return legacyCliReleaseFiles;
  if (schemaVersion === 6) return [...legacyCliReleaseFiles, ...legacyCliNativeFiles].sort();
  if (schemaVersion === 7) return cliCasReleaseFiles;
  if (schemaVersion === 8) return cliReleaseFiles;
  if (schemaVersion === 9)
    return [...cliCasReleaseFiles, "dist/repository-runtime.json", ...runtimeFiles].sort();
  return [];
}
