import { constants } from "node:fs";
import { lstat, mkdir, open } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { RuntimeSecurityError } from "./errors.js";

function ownerOnly(mode: number): boolean {
  return process.platform === "win32" || (mode & 0o077) === 0;
}

/** Ensures SQLite, WAL, and SHM files live below an owner-only real directory. */
export async function prepareOwnerOnlyDatabasePath(path: string): Promise<string> {
  const absolutePath = resolve(path);
  const parent = dirname(absolutePath);
  try {
    await mkdir(parent, { recursive: true, mode: 0o700 });
    const parentMetadata = await lstat(parent);
    if (!parentMetadata.isDirectory() || parentMetadata.isSymbolicLink() ||
      !ownerOnly(parentMetadata.mode)) {
      throw new Error("unsafe database directory");
    }
    const handle = await open(
      absolutePath,
      constants.O_RDWR | constants.O_CREAT | constants.O_NOFOLLOW,
      0o600,
    );
    try {
      const metadata = await handle.stat();
      if (!metadata.isFile() || metadata.isSymbolicLink() || !ownerOnly(metadata.mode)) {
        throw new Error("unsafe database file");
      }
    } finally {
      await handle.close();
    }
    return absolutePath;
  } catch (error) {
    throw new RuntimeSecurityError(
      "unsafe_database",
      "Runtime database는 owner-only 디렉터리의 일반 파일이어야 합니다.",
      { cause: error },
    );
  }
}
