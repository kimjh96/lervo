import { constants } from "node:fs";
import { randomUUID } from "node:crypto";
import { lstat, mkdir, open, readFile, readdir, rename, rm } from "node:fs/promises";
import { resolve } from "node:path";

import type { RepositorySnapshot } from "@lervo/orchestrator";

export interface PreparedRepositorySnapshot extends RepositorySnapshot {
  schemaVersion: 1;
  observationId: string;
}

const DIRECTORY = ".lervo/state/terminal-integration/prepared-snapshots";
const MAXIMUM_SNAPSHOTS = 64;
const MAXIMUM_BYTES = 8 * 1024 * 1024;

function snapshotPath(root: string, observationId: string): string {
  if (!/^tobs_[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/u.test(observationId))
    throw new Error("The prepared snapshot observation ID is invalid.");
  return resolve(root, DIRECTORY, `${observationId}.json`);
}

function validate(value: unknown): PreparedRepositorySnapshot {
  const snapshot = value as Partial<PreparedRepositorySnapshot> | null;
  if (
    snapshot === null ||
    typeof snapshot !== "object" ||
    snapshot.schemaVersion !== 1 ||
    typeof snapshot.observationId !== "string" ||
    typeof snapshot.revision !== "string" ||
    !/^sha256:[a-f0-9]{64}$/u.test(snapshot.revision) ||
    snapshot.files === null ||
    typeof snapshot.files !== "object" ||
    Array.isArray(snapshot.files) ||
    Object.keys(snapshot.files).length > 20_000 ||
    !Object.entries(snapshot.files).every(
      ([path, hash]) =>
        path.length > 0 &&
        !path.startsWith("/") &&
        !path.includes("\\") &&
        !path.split("/").some((part) => part.length === 0 || part === "." || part === "..") &&
        typeof hash === "string" &&
        /^sha256:[a-f0-9]{64}$/u.test(hash),
    )
  )
    throw new Error("The prepared repository snapshot is invalid.");
  return snapshot as PreparedRepositorySnapshot;
}

export async function writePreparedRepositorySnapshot(
  root: string,
  snapshot: PreparedRepositorySnapshot,
): Promise<void> {
  const directory = resolve(root, DIRECTORY);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const stats = await lstat(directory);
  if (!stats.isDirectory() || stats.isSymbolicLink())
    throw new Error("Unsafe prepared snapshot state directory.");
  const bytes = `${JSON.stringify(snapshot)}\n`;
  if (Buffer.byteLength(bytes) > MAXIMUM_BYTES)
    throw new Error("The prepared repository snapshot exceeds its storage limit.");
  const temporary = resolve(directory, `.prepared-${randomUUID()}.tmp`);
  let handle;
  try {
    handle = await open(
      temporary,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0),
      0o600,
    );
    await handle.writeFile(bytes);
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(temporary, snapshotPath(root, snapshot.observationId));
  } finally {
    await handle?.close();
    await rm(temporary, { force: true });
  }
  const entries = (await readdir(directory, { withFileTypes: true }))
    .filter(
      (entry) => entry.isFile() && /^tobs_[A-Za-z0-9][A-Za-z0-9_-]{7,63}\.json$/u.test(entry.name),
    )
    .sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of entries.slice(0, Math.max(0, entries.length - MAXIMUM_SNAPSHOTS)))
    await rm(resolve(directory, entry.name), { force: true });
}

export async function readPreparedRepositorySnapshot(
  root: string,
  observationId: string,
): Promise<PreparedRepositorySnapshot | null> {
  try {
    const path = snapshotPath(root, observationId);
    const stats = await lstat(path);
    if (!stats.isFile() || stats.isSymbolicLink() || stats.size > MAXIMUM_BYTES)
      throw new Error("The prepared repository snapshot is unsafe.");
    const snapshot = validate(JSON.parse(await readFile(path, "utf8")));
    if (snapshot.observationId !== observationId)
      throw new Error("The prepared repository snapshot coordinate does not match.");
    return snapshot;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}
