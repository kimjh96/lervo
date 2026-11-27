import { lstat, open, readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { EVENT_WRITER_BACKUP_DIRECTORY } from "./event-writer-activation-backup.js";

/** One `schema-<n>` directory; only a verified one can be the rollback point or be dated. */
export interface EventWriterBackupEntry {
  name: string;
  version: number;
  /** Device and inode of the directory, bound by the plan and checked again before removal. */
  identity: string;
  bytes: number;
  /** From `backup.json`; null when the backup is not verified. */
  createdAt: string | null;
  verified: boolean;
}

/** A `.retired-*` directory an interrupted removal left behind. */
export interface RetiredEventWriterBackup {
  name: string;
  identity: string;
  bytes: number;
}

export type EventWriterBackupInventory =
  | { root: "absent" }
  | { root: "unsafe" }
  | { root: "directory"; backups: EventWriterBackupEntry[]; retired: RetiredEventWriterBackup[] };

const BACKUP_FILES = new Set(["events.sqlite", "event-contract.json", "backup.json"]);
const SQLITE_HEADER = Buffer.from("SQLite format 3\0", "latin1");
/** The directory holds one backup per activated version; more entries are not Lervo's layout. */
const MAXIMUM_ENTRIES = 256;
const RETIRED_NAME = /^\.retired-schema-[1-9][0-9]{0,3}-[0-9a-f-]{36}$/u;

async function lstatOrNull(path: string) {
  return lstat(path).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
}

/** Every component from the repository root down must be a real directory, never a link. */
export async function eventWriterBackupRoot(
  repositoryRoot: string,
): Promise<"absent" | "unsafe" | "directory"> {
  let path = repositoryRoot;
  for (const component of EVENT_WRITER_BACKUP_DIRECTORY.split("/")) {
    path = resolve(path, component);
    const info = await lstatOrNull(path);
    if (info === null) return "absent";
    if (info.isSymbolicLink() || !info.isDirectory()) return "unsafe";
  }
  return "directory";
}

/** Regular files of the backup layout only; a link, a subdirectory or a foreign name rejects it. */
async function backupFiles(directory: string): Promise<Map<string, number> | null> {
  const files = new Map<string, number>();
  for (const name of await readdir(directory)) {
    if (!BACKUP_FILES.has(name)) return null;
    const info = await lstat(resolve(directory, name));
    if (info.isSymbolicLink() || !info.isFile()) return null;
    files.set(name, info.size);
  }
  return files;
}

async function sqliteHeader(path: string): Promise<boolean> {
  const handle = await open(path, "r");
  try {
    const header = Buffer.alloc(SQLITE_HEADER.length);
    const { bytesRead } = await handle.read(header, 0, header.length, 0);
    return bytesRead === header.length && header.equals(SQLITE_HEADER);
  } finally {
    await handle.close();
  }
}

/**
 * ADR-0470's `backup.json` with each file it declares copied present: the database starts with
 * the SQLite header and the coordinate parses. A failed check leaves the backup unverified.
 */
async function verifiedCreatedAt(
  directory: string,
  version: number,
  files: Map<string, number>,
): Promise<string | null> {
  if (!files.has("backup.json")) return null;
  try {
    const record = JSON.parse(await readFile(resolve(directory, "backup.json"), "utf8")) as Record<
      string,
      unknown
    >;
    if (
      record.schemaVersion !== 1 ||
      record.kind !== "event_writer_activation_backup" ||
      record.targetEventSchemaVersion !== version ||
      typeof record.createdAt !== "string" ||
      Number.isNaN(Date.parse(record.createdAt))
    )
      return null;
    for (const [field, file] of [
      ["eventDatabase", "events.sqlite"],
      ["coordinate", "event-contract.json"],
    ] as const) {
      if (record[field] === "absent" && !files.has(file)) continue;
      if (record[field] !== "copied" || !files.has(file)) return null;
    }
    if (files.has("events.sqlite") && !(await sqliteHeader(resolve(directory, "events.sqlite"))))
      return null;
    if (files.has("event-contract.json"))
      JSON.parse(await readFile(resolve(directory, "event-contract.json"), "utf8"));
    return record.createdAt;
  } catch {
    return null;
  }
}

/**
 * Read-only inventory of `.lervo/data/event-writer-backups`. Entries that are not a `schema-<n>`
 * or `.retired-schema-<n>-<uuid>` directory, such as an activation's `.preparing-*` directory,
 * are not listed and therefore never touched.
 */
export async function readEventWriterBackupInventory(
  repositoryRoot: string,
): Promise<EventWriterBackupInventory> {
  const root = await eventWriterBackupRoot(repositoryRoot);
  if (root !== "directory") return { root };
  const directory = resolve(repositoryRoot, EVENT_WRITER_BACKUP_DIRECTORY);
  const entries = await readdir(directory, { withFileTypes: true });
  if (entries.length > MAXIMUM_ENTRIES) return { root: "unsafe" };
  const backups: EventWriterBackupEntry[] = [];
  const retired: RetiredEventWriterBackup[] = [];
  for (const entry of entries) {
    const match = /^schema-([1-9][0-9]{0,3})$/u.exec(entry.name);
    if (match === null && !RETIRED_NAME.test(entry.name)) continue;
    const path = resolve(directory, entry.name);
    const info = await lstat(path);
    if (info.isSymbolicLink() || !info.isDirectory()) continue;
    const files = await backupFiles(path);
    const identity = `${info.dev}:${info.ino}`;
    if (match === null) {
      if (files !== null) retired.push({ name: entry.name, identity, bytes: total(files) });
      continue;
    }
    const version = Number(match[1]);
    const createdAt = files === null ? null : await verifiedCreatedAt(path, version, files);
    backups.push({
      name: entry.name,
      version,
      identity,
      bytes: files === null ? 0 : total(files),
      createdAt,
      verified: createdAt !== null,
    });
  }
  backups.sort((left, right) => left.version - right.version);
  retired.sort((left, right) => left.name.localeCompare(right.name));
  return { root: "directory", backups, retired };
}

function total(files: Map<string, number>): number {
  let bytes = 0;
  for (const size of files.values()) bytes += size;
  return bytes;
}
