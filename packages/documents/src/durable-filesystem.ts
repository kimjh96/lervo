import { constants } from "node:fs";
import { lstat, mkdir, open, realpath, rmdir, unlink } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";

import { absoluteRepositoryPath, readStableFile } from "./filesystem.js";
import { sha256 } from "./hash.js";
import { DocumentMigrationError } from "./types.js";

export async function writeDurableExclusive(
  path: string,
  bytes: Uint8Array,
): Promise<void> {
  let handle;
  try {
    handle = await open(
      path,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL |
        (constants.O_NOFOLLOW ?? 0),
      0o600,
    );
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle?.close();
  }
}

export async function syncDirectory(path: string): Promise<void> {
  const handle = await open(path, constants.O_RDONLY);
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

export async function removeFileIfUnchanged(input: {
  root: string;
  path: string;
  contentHash: string;
  maximumBytes: number;
}): Promise<boolean> {
  try {
    const bytes = await readStableFile(input.root, input.path, input.maximumBytes);
    if (sha256(bytes) !== input.contentHash) return false;
    await unlink(absoluteRepositoryPath(input.root, input.path));
    return true;
  } catch {
    return false;
  }
}

export async function ensureSafeDirectoryPath(
  root: string,
  relativeDirectory: string,
): Promise<string[]> {
  const target = absoluteRepositoryPath(root, relativeDirectory);
  const child = relative(root, target);
  if (child === ".." || child.startsWith(`..${sep}`)) {
    throw new DocumentMigrationError(
      "migration_conflict",
      "Migration directory가 저장소 root 밖을 가리킵니다.",
    );
  }
  const segments = child.split(sep).filter(Boolean);
  const created: string[] = [];
  let current = root;
  for (const segment of segments) {
    const parent = current;
    current = resolve(current, segment);
    try {
      const stats = await lstat(current);
      if (!stats.isDirectory() || stats.isSymbolicLink() || await realpath(current) !== current) {
        throw new DocumentMigrationError(
          "migration_conflict",
          "Migration directory 경로에 안전하지 않은 항목이 있습니다.",
        );
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      try {
        await mkdir(current, { mode: 0o700 });
        created.push(current);
        await syncDirectory(parent);
      } catch (createError) {
        if ((createError as NodeJS.ErrnoException).code !== "EEXIST") throw createError;
        const stats = await lstat(current);
        if (!stats.isDirectory() || stats.isSymbolicLink() || await realpath(current) !== current) {
          throw new DocumentMigrationError(
            "migration_conflict",
            "Migration directory를 안전하게 만들 수 없습니다.",
          );
        }
      }
    }
  }
  return created;
}

export async function removeCreatedDirectories(paths: readonly string[]): Promise<boolean> {
  let safe = true;
  for (const path of [...paths].reverse()) {
    try {
      await rmdir(path);
      await syncDirectory(dirname(path));
    } catch {
      safe = false;
    }
  }
  return safe;
}
