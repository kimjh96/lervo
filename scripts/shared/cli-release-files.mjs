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
export const cliReleaseFiles = Object.freeze([...legacyCliReleaseFiles, ...cliNativeFiles].sort());

export function cliReleaseFilesForSchema(schemaVersion) {
  if (schemaVersion === 5) return legacyCliReleaseFiles;
  if (schemaVersion === 6) return [...legacyCliReleaseFiles, ...legacyCliNativeFiles].sort();
  if (schemaVersion === 7) return cliReleaseFiles;
  return [];
}
