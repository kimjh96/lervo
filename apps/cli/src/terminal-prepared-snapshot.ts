import { constants } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, open, readFile, readdir, rename, rm, utimes } from "node:fs/promises";
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
    (snapshot.commits !== undefined &&
      (snapshot.commits === null ||
        typeof snapshot.commits !== "object" ||
        Array.isArray(snapshot.commits) ||
        Object.entries(snapshot.commits).some(
          ([path, commit]) =>
            !(path in snapshot.files!) ||
            typeof commit !== "string" ||
            !/^[a-f0-9]{40,64}$/u.test(commit),
        ))) ||
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

/** A prepared snapshot's file hashes, stored once under the hash of its bytes. */
const CONTENT_DIRECTORY = "contents";
const CONTENT_NAME = /^sha256-([a-f0-9]{64})\.json$/u;
const POINTER_NAME = /^tobs_[A-Za-z0-9][A-Za-z0-9_-]{7,63}\.json$/u;
/** A content file this young may belong to a concurrent writer whose pointer is not yet written. */
const CONTENT_GRACE_MILLISECONDS = 60_000;

interface PreparedSnapshotPointer {
  schemaVersion: 2;
  observationId: string;
  contentHash: string;
}

function sha256(bytes: string): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function contentPath(directory: string, contentHash: string): string {
  return resolve(directory, CONTENT_DIRECTORY, `${contentHash.replace(":", "-")}.json`);
}

async function safeDirectory(path: string): Promise<void> {
  await mkdir(path, { recursive: true, mode: 0o700 });
  const stats = await lstat(path);
  if (!stats.isDirectory() || stats.isSymbolicLink())
    throw new Error("Unsafe prepared snapshot state directory.");
}

/** Writes `bytes` to `path` through a synchronized, exclusively created temporary file. */
async function replaceFile(directory: string, path: string, bytes: string): Promise<void> {
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
    await rename(temporary, path);
  } finally {
    await handle?.close();
    await rm(temporary, { force: true });
  }
}

/**
 * Stores the observation's pointer and, unless an identical snapshot is already stored, its file
 * hashes. Consecutive prompts usually see the same files, so most prompts write only the pointer
 * instead of rewriting and synchronizing megabytes, and retention keeps one copy of each content.
 */
export async function writePreparedRepositorySnapshot(
  root: string,
  snapshot: PreparedRepositorySnapshot,
): Promise<void> {
  const directory = resolve(root, DIRECTORY);
  await safeDirectory(directory);
  await safeDirectory(resolve(directory, CONTENT_DIRECTORY));
  const pointerPath = snapshotPath(root, snapshot.observationId);
  const { observationId: _observationId, ...content } = snapshot;
  const bytes = `${JSON.stringify(content)}\n`;
  if (Buffer.byteLength(bytes) > MAXIMUM_BYTES)
    throw new Error("The prepared repository snapshot exceeds its storage limit.");
  const contentHash = sha256(bytes);
  const stored = contentPath(directory, contentHash);
  // Reused content is touched, so another writer's retention, which spares content modified in the
  // last minute, cannot remove it before this pointer names it.
  // Content that changed on disk, or vanished while being touched, is written again, so a bad file
  // never stays shared by every later prompt with the same files.
  const storeContent = async () => {
    const existing = await lstat(stored).catch(() => null);
    if (existing?.isFile() === true && !existing.isSymbolicLink()) {
      const current = await readFile(stored, "utf8").catch(() => null);
      const now = new Date();
      if (
        current === bytes &&
        (await utimes(stored, now, now).then(
          () => true,
          () => false,
        ))
      )
        return;
    }
    await replaceFile(directory, stored, bytes);
  };
  await storeContent();
  const pointer: PreparedSnapshotPointer = {
    schemaVersion: 2,
    observationId: snapshot.observationId,
    contentHash,
  };
  await replaceFile(directory, pointerPath, `${JSON.stringify(pointer)}\n`);
  // Content removed between the check and the pointer, by a retention that saw neither, is written
  // again, so a written pointer never names missing content.
  await storeContent();
  await retainPreparedSnapshots(directory, `${snapshot.observationId}.json`, contentHash);
}

/** Keeps the newest 64 pointers, then removes content no remaining pointer names. */
async function retainPreparedSnapshots(
  directory: string,
  currentName: string,
  currentContent: string,
): Promise<void> {
  const entries = await Promise.all(
    (await readdir(directory, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && POINTER_NAME.test(entry.name))
      .map(async (entry) => ({
        name: entry.name,
        modifiedAt: (await lstat(resolve(directory, entry.name))).mtimeMs,
      })),
  );
  entries.sort(
    (left, right) =>
      Number(left.name === currentName) - Number(right.name === currentName) ||
      left.modifiedAt - right.modifiedAt ||
      left.name.localeCompare(right.name),
  );
  const excess = Math.max(0, entries.length - MAXIMUM_SNAPSHOTS);
  for (const entry of entries.slice(0, excess))
    await rm(resolve(directory, entry.name), { force: true });
  const referenced = new Set([currentContent]);
  for (const entry of entries.slice(excess)) {
    // A schema 1 record holds its own hashes; an unreadable pointer protects nothing.
    const pointer = await readFile(resolve(directory, entry.name), "utf8")
      .then((text) => JSON.parse(text) as Partial<PreparedSnapshotPointer>)
      .catch(() => null);
    if (pointer?.schemaVersion === 2 && typeof pointer.contentHash === "string")
      referenced.add(pointer.contentHash);
  }
  const contents = resolve(directory, CONTENT_DIRECTORY);
  const now = Date.now();
  for (const entry of await readdir(contents, { withFileTypes: true })) {
    const match = CONTENT_NAME.exec(entry.name);
    if (!entry.isFile() || match === null || referenced.has(`sha256:${match[1]}`)) continue;
    const path = resolve(contents, entry.name);
    const modifiedAt = (await lstat(path).catch(() => null))?.mtimeMs;
    if (modifiedAt !== undefined && now - modifiedAt >= CONTENT_GRACE_MILLISECONDS)
      await rm(path, { force: true });
  }
}

async function readBounded(path: string): Promise<string> {
  const stats = await lstat(path);
  if (!stats.isFile() || stats.isSymbolicLink() || stats.size > MAXIMUM_BYTES)
    throw new Error("The prepared repository snapshot is unsafe.");
  return readFile(path, "utf8");
}

export async function readPreparedRepositorySnapshot(
  root: string,
  observationId: string,
): Promise<PreparedRepositorySnapshot | null> {
  try {
    const path = snapshotPath(root, observationId);
    const record = JSON.parse(await readBounded(path)) as Record<string, unknown> | null;
    let snapshot: PreparedRepositorySnapshot;
    if (record?.schemaVersion === 2) {
      const pointer = record as Partial<PreparedSnapshotPointer>;
      if (
        pointer.observationId !== observationId ||
        typeof pointer.contentHash !== "string" ||
        !/^sha256:[a-f0-9]{64}$/u.test(pointer.contentHash)
      )
        throw new Error("The prepared repository snapshot pointer is invalid.");
      const bytes = await readBounded(contentPath(resolve(root, DIRECTORY), pointer.contentHash));
      // The content is addressed by its hash, so stored bytes that changed are rejected.
      if (sha256(bytes) !== pointer.contentHash)
        throw new Error("The prepared repository snapshot content does not match its pointer.");
      snapshot = validate({ ...(JSON.parse(bytes) as object), observationId });
    } else snapshot = validate(record);
    if (snapshot.observationId !== observationId)
      throw new Error("The prepared repository snapshot coordinate does not match.");
    return snapshot;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}
