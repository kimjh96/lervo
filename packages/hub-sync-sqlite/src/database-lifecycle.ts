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
        "Hub sync SQLite 경로는 일반 파일이어야 하며 심볼릭 링크일 수 없습니다.",
      );
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  return absolutePath;
}
