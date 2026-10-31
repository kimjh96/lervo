import { constants } from "node:fs";
import { lstat, mkdir, open, realpath, rename, rm } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { createHash, randomUUID } from "node:crypto";

const ENTRY_FILE = "worker-entry.json";

async function entryHash(entry: string): Promise<string | null> {
  if ((await realpath(entry)) !== entry) return null;
  const handle = await open(
    entry,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  try {
    const metadata = await handle.stat();
    if (
      !metadata.isFile() ||
      process.getuid?.() !== metadata.uid ||
      (metadata.mode & 0o022) !== 0 ||
      metadata.size > 1024 * 1024
    )
      return null;
    const bytes = Buffer.alloc(1024 * 1024 + 1);
    const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
    if (bytesRead > 1024 * 1024) return null;
    return `sha256:${createHash("sha256").update(bytes.subarray(0, bytesRead)).digest("hex")}`;
  } finally {
    await handle.close();
  }
}

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
    const base = await directory(root);
    // A failed rebind must not preserve authority granted to an earlier installation.
    await rm(resolve(base, ENTRY_FILE), { force: true });
    if (!entry || !isAbsolute(entry) || entry.length > 4096) return;
    entry = await realpath(entry);
    const contentHash = await entryHash(entry);
    if (contentHash === null) return;
    temporary = resolve(base, `.${randomUUID()}.tmp`);
    const handle = await open(temporary, "wx", 0o600);
    try {
      await handle.writeFile(JSON.stringify({ entry, contentHash }));
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
      const metadata = await handle.stat();
      if (
        !metadata.isFile() ||
        metadata.uid !== process.getuid?.() ||
        (metadata.mode & 0o022) !== 0
      )
        return null;
      const bytes = Buffer.alloc(8193);
      const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
      if (bytesRead > 8192) return null;
      const value = JSON.parse(bytes.subarray(0, bytesRead).toString("utf8")) as {
        entry?: unknown;
        contentHash?: unknown;
      };
      return typeof value.entry === "string" &&
        isAbsolute(value.entry) &&
        value.entry.length <= 4096 &&
        typeof value.contentHash === "string" &&
        /^sha256:[a-f0-9]{64}$/u.test(value.contentHash) &&
        (await entryHash(value.entry)) === value.contentHash
        ? value.entry
        : null;
    } finally {
      await handle.close();
    }
  } catch {
    return null;
  }
}
