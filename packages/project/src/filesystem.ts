import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open } from "node:fs/promises";

export type FileSystemEntry =
  | { kind: "missing" }
  | { kind: "directory" }
  | { kind: "file"; content: string }
  | { kind: "unsupported"; description: string };

export function contentHash(content: string): string {
  return `sha256:${createHash("sha256").update(content).digest("hex")}`;
}

export async function readEntry(
  path: string,
  maximumFileBytes = 4 * 1024 * 1024,
): Promise<FileSystemEntry> {
  try {
    const stats = await lstat(path);
    if (stats.isSymbolicLink()) {
      return { kind: "unsupported", description: "symbolic link" };
    }
    if (stats.isDirectory()) {
      return { kind: "directory" };
    }
    if (stats.isFile()) {
      if (stats.size > maximumFileBytes) {
        return { kind: "unsupported", description: "file exceeding the size limit" };
      }
      let handle;
      try {
        handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
        const opened = await handle.stat();
        if (stats.dev !== opened.dev || stats.ino !== opened.ino) {
          return { kind: "unsupported", description: "file path changed before reading" };
        }
        const bytes = await handle.readFile();
        const after = await handle.stat();
        if (
          !after.isFile() ||
          after.size > maximumFileBytes ||
          stats.dev !== after.dev ||
          stats.ino !== after.ino ||
          stats.size !== after.size ||
          stats.mtimeMs !== after.mtimeMs
        ) {
          return { kind: "unsupported", description: "file changed while being read" };
        }
        try {
          return {
            kind: "file",
            content: new TextDecoder("utf-8", { fatal: true }).decode(bytes),
          };
        } catch {
          return { kind: "unsupported", description: "file that is not valid UTF-8" };
        }
      } catch {
        return { kind: "unsupported", description: "file that cannot be opened safely" };
      } finally {
        await handle?.close();
      }
    }
    return {
      kind: "unsupported",
      description: "entry that is neither a regular file nor a directory",
    };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      return { kind: "missing" };
    }
    if (code === "ENOTDIR") {
      return { kind: "unsupported", description: "entry whose parent path is not a directory" };
    }
    throw error;
  }
}
