import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, readdir, rename, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { deserialize, serialize } from "node:v8";

import { sha256 } from "./integrity.js";
import { readSafePublication } from "./repository-publication-files.js";

const directoryParts = [".lervo", "state", "knowledge", "indexes", "query-preparation"];
const MAXIMUM_CACHE_BYTES = 128 * 1024 * 1024;
type CacheName = "source-units" | "concept-sidecars" | "ranker";
const RUNTIME = `${process.versions.node}/${process.versions.unicode}/${process.versions.icu}`;

export function preparationCachePath(name: CacheName): string {
  return `${directoryParts.join("/")}/${name}.cache`;
}

/** A corrupt or unavailable projection is a miss, never a failed or incomplete source scan. */
export async function readPreparationCache(root: string, name: CacheName): Promise<unknown> {
  const bytes = await readSafePublication(root, preparationCachePath(name), MAXIMUM_CACHE_BYTES);
  if (bytes === null) return null;
  try {
    const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const split = buffer.indexOf(10);
    if (split !== 71) return null;
    const payload = buffer.subarray(split + 1);
    if (buffer.subarray(0, split).toString("ascii") !== sha256(payload)) return null;
    const envelope = deserialize(payload) as {
      schemaVersion?: unknown;
      runtime?: unknown;
      value?: unknown;
    } | null;
    return envelope?.schemaVersion === 2 && envelope.runtime === RUNTIME ? envelope.value : null;
  } catch {
    return null;
  }
}

async function cacheDirectory(root: string): Promise<string | null> {
  let path = resolve(root);
  const rootStats = await lstat(path);
  if (!rootStats.isDirectory() || rootStats.isSymbolicLink()) return null;
  for (const part of directoryParts) {
    path = resolve(path, part);
    try {
      await mkdir(path, { mode: 0o700 });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    const stats = await lstat(path);
    if (!stats.isDirectory() || stats.isSymbolicLink()) return null;
  }
  return path;
}

/** Atomic replacement; temporary files are producer-owned and swept before the next write. */
export async function writePreparationCache(
  root: string,
  name: CacheName,
  value: unknown,
): Promise<void> {
  let temporary: string | undefined;
  let handle;
  try {
    const payload = serialize({ schemaVersion: 2, runtime: RUNTIME, value });
    if (payload.byteLength + 72 > MAXIMUM_CACHE_BYTES) return;
    const directory = await cacheDirectory(root);
    if (directory === null) return;
    const prefix = `.${name}-`;
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.isFile() && new RegExp(`^\\.${name}-[a-f0-9-]{36}\\.tmp$`, "u").test(entry.name)) {
        // A racing writer may lose its temporary file; its fresh query result is unaffected.
        await rm(resolve(directory, entry.name), { force: true }).catch(() => undefined);
      }
    }
    temporary = resolve(directory, `${prefix}${randomUUID()}.tmp`);
    handle = await open(
      temporary,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0),
      0o600,
    );
    await handle.writeFile(`${sha256(payload)}\n`);
    await handle.writeFile(payload);
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(temporary, resolve(directory, `${name}.cache`));
  } catch {
    // Persistence is optional. Fresh computation and its original failure meanings remain intact.
  } finally {
    await handle?.close().catch(() => undefined);
    if (temporary !== undefined) await rm(temporary, { force: true }).catch(() => undefined);
  }
}
