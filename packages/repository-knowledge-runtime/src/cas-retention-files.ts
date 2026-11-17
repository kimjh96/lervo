import { sqliteReferenceChunk, type SqliteReferenceCursor } from "./cas-retention-sqlite.js";
import { isSqliteLockContention } from "@lervo/sqlite-connection";
import { CasRetentionBoundError } from "./cas-retention-errors.js";
import { constants, type Dirent } from "node:fs";
import { lstat, open, readdir, realpath, unlink } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import type { ProjectStorage } from "@lervo/project-storage";
import { inspectRepositoryCoordinationHome } from "@lervo/project-storage";
import { casReferences } from "./cas-retention-references.js";
import type { EventWriterBackupMirror } from "./cas-retention-backups.js";

export interface CasReferenceFile {
  key: string;
  path: string;
  identity: string;
  size: number;
  modifiedAt: number;
  hash: string | null;
  /** Set only on an event-writer backup database (ADR-0585). */
  mirror?: EventWriterBackupMirror;
}

export const CAS_RETENTION_SCAN = "cas-retention-scan.json";
export const CAS_RETENTION_OBSERVATION = "cas-retention-observation.json";
const MAXIMUM_FILES = 100_000;

/** A path removed between listing and inspection: live writers replace and consume state files. */
function vanished(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | null)?.code === "ENOENT";
}

const APPLE_DOUBLE_MAGIC = Buffer.from([0x00, 0x05, 0x16, 0x07]);

/**
 * Copying from macOS can leave `._<name>` AppleDouble metadata beside a file. Lervo never writes
 * one, so only that exact name and magic are skipped; any other unreadable file fails closed.
 */
async function isAppleDouble(path: string, name: string): Promise<boolean> {
  if (!name.startsWith("._")) return false;
  // A vanished file is skipped by the inventory itself; any other open failure fails closed.
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW).catch(
    (error: unknown) => {
      if (vanished(error)) return null;
      throw error;
    },
  );
  if (handle === null) return false;
  try {
    const magic = Buffer.alloc(APPLE_DOUBLE_MAGIC.length);
    const { bytesRead } = await handle.read(magic, 0, magic.length, 0);
    return bytesRead === magic.length && magic.equals(APPLE_DOUBLE_MAGIC);
  } finally {
    await handle.close();
  }
}

export async function referenceFile(path: string, hash: string | null): Promise<CasReferenceFile> {
  const stat = await lstat(path);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("Unsafe CAS reference file.");
  const wal = /\.(?:sqlite|db)$/u.test(path)
    ? await lstat(`${path}-wal`).catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return null;
        throw error;
      })
    : null;
  if (wal?.isSymbolicLink()) throw new Error("Unsafe SQLite reference journal.");
  return {
    key: hash ?? path,
    path,
    hash,
    size: stat.size,
    modifiedAt: stat.mtimeMs,
    identity: `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}:${wal ? `${wal.ino}:${wal.size}:${wal.mtimeMs}:${wal.ctimeMs}` : ""}`,
  };
}

/** A directory removed while the walk was pending has no entries left to reference. */
async function referenceDirectoryEntries(path: string): Promise<Dirent[]> {
  try {
    const info = await lstat(path);
    if (info.isSymbolicLink()) throw new Error("Unsafe subsystem reference directory.");
    if (!info.isDirectory()) throw new Error("Invalid subsystem reference directory.");
    return await readdir(path, { withFileTypes: true });
  } catch (error) {
    if (vanished(error)) return [];
    throw error;
  }
}

/**
 * Inventory metadata only. Bodies are scanned in resumable, bounded chunks. Links fail closed. A
 * path that vanishes while listed is skipped: the final inventory comparison before any unlink
 * still observes its replacement (ADR-0584).
 */
export async function casReferenceFiles(storage: ProjectStorage): Promise<CasReferenceFile[]> {
  const files: CasReferenceFile[] = [];
  const add = async (path: string, hash: string | null) => {
    if (files.length >= MAXIMUM_FILES)
      throw new CasRetentionBoundError("CAS reference inventory exceeds its bound.");
    try {
      files.push(await referenceFile(path, hash));
    } catch (error) {
      if (!vanished(error)) throw error;
    }
  };
  const objects = resolve(storage.paths.cas, "sha256");
  if ((await realpath(objects)) !== objects) throw new Error("Unsafe CAS root.");
  for (const shard of await readdir(objects, { withFileTypes: true })) {
    if (!/^[a-f0-9]{2}$/u.test(shard.name)) continue;
    if (!shard.isDirectory() || shard.isSymbolicLink()) throw new Error("Unsafe CAS shard.");
    for (const object of await readdir(resolve(objects, shard.name), { withFileTypes: true })) {
      if (!/^[a-f0-9]{62}$/u.test(object.name)) continue;
      await add(resolve(objects, shard.name, object.name), `${shard.name}${object.name}`);
    }
  }
  const home = await inspectRepositoryCoordinationHome(storage.paths.repositoryRoot);
  const pending = [storage.paths.lervoRoot, ...(home === null ? [] : [home.root])];
  const visited = new Set<string>();
  const excluded = new Set([
    storage.paths.cas,
    resolve(storage.paths.knowledgeState, "convergence-workspaces"),
    storage.paths.knowledgeIndexes,
    ...(home === null ? [] : [home.locks]),
  ]);
  while (pending.length) {
    const path = pending.pop()!;
    if (visited.has(path) || excluded.has(path)) continue;
    visited.add(path);
    if (visited.size > MAXIMUM_FILES)
      throw new CasRetentionBoundError("CAS reference directory inventory exceeds its bound.");
    for (const entry of await referenceDirectoryEntries(path)) {
      const child = resolve(path, entry.name);
      if (excluded.has(child)) continue;
      if (
        (path === storage.paths.knowledgeState && entry.name.startsWith("cas-retention-")) ||
        (path === storage.paths.state && entry.name.startsWith("knowledge-worker")) ||
        child === storage.paths.eventDatabase ||
        child.startsWith(`${storage.paths.eventDatabase}-`)
      )
        continue;
      if (entry.isSymbolicLink()) throw new Error("Unsafe subsystem reference file.");
      if (entry.isDirectory()) pending.push(child);
      else if (entry.isFile()) {
        if (!(await isAppleDouble(child, entry.name))) await add(child, null);
      } else throw new Error("Unsupported subsystem reference file.");
    }
  }
  return files.sort((left, right) => left.key.localeCompare(right.key));
}

export interface ReferenceScan {
  identity: string;
  complete: boolean;
  sqlite?: SqliteReferenceCursor;
  offset: number;
  tail: string;
  references: string[];
}

export interface ReferenceChunkRead {
  scan: ReferenceScan;
  bytesRead: number;
}

/**
 * Read at most one MiB; the overlap preserves references crossing any chunk boundary. Null means
 * the file changed or vanished since the inventory, or a live SQLite writer held its lock: the
 * caller restarts that file and sweeps nothing this cycle (ADR-0584).
 */
export async function scanReferenceChunk(
  file: CasReferenceFile,
  prior: ReferenceScan,
  eligible: ReadonlySet<string>,
  maximumBytes = 1024 * 1024,
): Promise<ReferenceChunkRead | null> {
  try {
    return await readReferenceChunk(file, prior, eligible, maximumBytes);
  } catch (error) {
    if (vanished(error) || isSqliteLockContention(error)) return null;
    throw error;
  }
}

async function hasWriteAheadLog(path: string): Promise<boolean> {
  try {
    await lstat(`${path}-wal`);
    return true;
  } catch (error) {
    if (vanished(error)) return false;
    throw error;
  }
}

async function readReferenceChunk(
  file: CasReferenceFile,
  prior: ReferenceScan,
  eligible: ReadonlySet<string>,
  maximumBytes: number,
): Promise<ReferenceChunkRead | null> {
  if (file.hash === null && /\.(?:sqlite|db)$/u.test(file.path)) {
    if ((await referenceFile(file.path, null)).identity !== file.identity) return null;
    // SQLite treats a zero-byte file as an empty database. Without a WAL, it has no cells to read.
    if (file.size === 0 && !(await hasWriteAheadLog(file.path)))
      return { scan: { ...prior, complete: true }, bytesRead: 0 };
    const result = sqliteReferenceChunk(
      file.path,
      prior.sqlite ?? { table: 0, row: 0 },
      eligible,
      file.mirror,
    );
    for (const hash of result.mirrored) file.mirror?.released?.add(hash);
    return {
      scan: {
        ...prior,
        complete: result.complete,
        sqlite: result.cursor,
        references: [...new Set([...prior.references, ...result.references])],
      },
      bytesRead: result.bytesRead,
    };
  }
  const handle = await open(file.path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    if ((await referenceFile(file.path, file.hash)).identity !== file.identity) return null;
    const buffer = Buffer.alloc(Math.min(1024 * 1024, maximumBytes, file.size - prior.offset));
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, prior.offset);
    if (buffer.length && !bytesRead) return null;
    const text = prior.tail + buffer.subarray(0, bytesRead).toString("latin1");
    const references = new Set(prior.references);
    for (const hash of casReferences(text)) if (eligible.has(hash)) references.add(hash);
    const complete = prior.offset + bytesRead >= file.size;
    return {
      scan: {
        identity: file.identity,
        complete,
        offset: prior.offset + bytesRead,
        // Only an unfinished body needs the overlap; completed entries stay small (ADR-0584).
        tail: complete ? "" : text.slice(-96),
        references: [...references],
      },
      bytesRead,
    };
  } finally {
    await handle.close();
  }
}

/** A single unlink is the crash boundary; no reachable object or reference record is mutated. */
export async function removeUnreachableCasObject(
  file: CasReferenceFile,
  assertCurrent: () => void = () => {},
): Promise<void> {
  if (file.hash === null || !/^[a-f0-9]{64}$/u.test(file.hash))
    throw new Error("Invalid CAS collection target.");
  if ((await realpath(dirname(file.path))) !== dirname(file.path))
    throw new Error("CAS collection shard changed.");
  if ((await referenceFile(file.path, file.hash)).identity !== file.identity)
    throw new Error("CAS collection target changed.");
  assertCurrent();
  await unlink(file.path);
}
