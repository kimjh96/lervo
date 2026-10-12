import { constants } from "node:fs";
import { open } from "node:fs/promises";

export function supportsDirectorySync(platform: NodeJS.Platform): boolean {
  return platform !== "win32";
}

export async function syncDirectory(
  path: string,
  platform: NodeJS.Platform = process.platform,
): Promise<void> {
  // Windows does not support fsync on directory handles. Callers must sync file contents first.
  if (!supportsDirectorySync(platform)) return;
  const handle = await open(path, constants.O_RDONLY);
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

export { createFileSyncBatch } from "./file-sync-batch.js";
