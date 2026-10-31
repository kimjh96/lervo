import { constants } from "node:fs";
import { lstat, mkdir, open, rename, rm } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { randomUUID } from "node:crypto";

const ENTRY_FILE = "worker-entry.json";

async function directory(root: string): Promise<string> {
  let path = root;
  for (const part of [".lervo", "state", "terminal-integration"]) {
    path = resolve(path, part);
    await mkdir(path, { mode: 0o700 }).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "EEXIST") throw error;
    });
    const metadata = await lstat(path);
    if (!metadata.isDirectory() || metadata.isSymbolicLink())
      throw new Error("Unsafe terminal state.");
  }
  return path;
}

/** Installation binds the full CLI locally; generated hook code remains portable across hosts. */
export async function rememberTerminalWorkerEntry(
  root: string,
  entry: string | undefined,
): Promise<void> {
  let temporary: string | undefined;
  try {
    if (!entry || !isAbsolute(entry) || entry.length > 4096) return;
    const base = await directory(root);
    temporary = resolve(base, `.${randomUUID()}.tmp`);
    const handle = await open(temporary, "wx", 0o600);
    try {
      await handle.writeFile(JSON.stringify({ entry }));
    } finally {
      await handle.close();
    }
    await rename(temporary, resolve(base, ENTRY_FILE));
  } catch {
    /* An unavailable fallback leaves work for the resident. */
  } finally {
    if (temporary) await rm(temporary, { force: true }).catch(() => {});
  }
}

export async function terminalWorkerEntry(root: string): Promise<string | null> {
  try {
    const handle = await open(
      resolve(await directory(root), ENTRY_FILE),
      constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | constants.O_NONBLOCK,
    );
    try {
      const bytes = Buffer.alloc(8193);
      const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
      if (bytesRead > 8192) return null;
      const value = JSON.parse(bytes.subarray(0, bytesRead).toString("utf8")) as {
        entry?: unknown;
      };
      return typeof value.entry === "string" &&
        isAbsolute(value.entry) &&
        value.entry.length <= 4096
        ? value.entry
        : null;
    } finally {
      await handle.close();
    }
  } catch {
    return null;
  }
}
