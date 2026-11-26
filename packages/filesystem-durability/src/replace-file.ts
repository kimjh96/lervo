import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { chmod, open, rename, rm } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";

import { syncDirectory } from "./directory-sync.js";

export interface ReplaceFileOptions {
  /** The file mode the replacement gets, whatever the process mask; owner-only by default. */
  mode?: number;
  /** Whether the directory entry is synced too, so the rename itself survives a power loss. */
  syncDirectory?: boolean;
  platform?: NodeJS.Platform;
}

/**
 * Replaces `path` with `content` so a reader sees the old bytes or the new, never a mix: the
 * content goes to a hidden temporary file beside it, is synced, and is renamed over `path`; the
 * directory is then synced. A failure leaves `path` as it was and removes the temporary file.
 */
export async function replaceFile(
  path: string,
  content: string | Uint8Array,
  options: ReplaceFileOptions = {},
): Promise<void> {
  const mode = options.mode ?? 0o600;
  const temporary = resolve(dirname(path), `.${basename(path)}.${process.pid}.${randomUUID()}.tmp`);
  let renamed = false;
  try {
    const handle = await open(
      temporary,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0),
      mode,
    );
    try {
      await handle.writeFile(content);
      await handle.sync();
    } finally {
      await handle.close();
    }
    // The process mask may have narrowed the mode the file was created with.
    await chmod(temporary, mode);
    await rename(temporary, path);
    renamed = true;
    if (options.syncDirectory ?? true) await syncDirectory(dirname(path), options.platform);
  } finally {
    if (!renamed) await rm(temporary, { force: true });
  }
}
