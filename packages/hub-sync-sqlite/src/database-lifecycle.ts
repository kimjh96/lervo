import { lstat, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { HubSyncStoreError } from "./errors.js";

export async function ensureDatabasePath(path: string): Promise<string> {
  const absolutePath = resolve(path);
  await mkdir(dirname(absolutePath), { recursive: true });
  try {
    const stats = await lstat(absolutePath);
    if (stats.isSymbolicLink() || !stats.isFile()) {
      throw new HubSyncStoreError(
        "integrity_failed",
        "The Hub sync SQLite path must be a regular file and cannot be a symbolic link.",
      );
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  return absolutePath;
}
