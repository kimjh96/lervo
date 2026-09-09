import type { Dirent } from "node:fs";

/**
 * Finder metadata and AppleDouble sidecars are transport artifacts, not
 * repository or Lervo records. Only regular files are ignored so a directory
 * or symbolic link with the same prefix still fails the owning safety check.
 */
export function isIgnorableFilesystemMetadata(entry: Dirent): boolean {
  return (
    entry.isFile() &&
    !entry.isSymbolicLink() &&
    (entry.name === ".DS_Store" || entry.name.startsWith("._"))
  );
}
