import type { Dirent } from "node:fs";
import { lstat } from "node:fs/promises";
import { join } from "node:path";

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

/**
 * A nested directory with its own `.git` entry is another working tree (a linked worktree, a
 * submodule, or a separate clone). Its bytes belong to that repository, so the scan never descends
 * into it; Git's own exclude files are not consulted because the scan is filesystem-based.
 */
export async function isNestedGitWorkingTree(directory: string): Promise<boolean> {
  try {
    await lstat(join(directory, ".git"));
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}
