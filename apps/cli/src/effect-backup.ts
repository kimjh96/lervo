import { createHash, randomBytes } from "node:crypto";
import { chmod, lstat, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";

import { capabilityRoot } from "@lervo/capabilities";
import { resolveProjectPaths } from "@lervo/project";

import { CommandFailure } from "./command-error-output.js";

/**
 * ADR-0561 step two for effects Git does not hold: provider hook files, a derived-state reset,
 * capability packages, and skill authorization manifests. A backup is taken before the write,
 * sealed with the written result, and restored by `lervo state restore <backup-id>`.
 */
export type EffectBackupKind =
  | "terminal_integration"
  | "state_reset"
  | "capability_install"
  | "capability_migration"
  | "skill_authorization";

interface FileEntry {
  kind: "file";
  path: string;
  /** The stored preimage file name, or null when the path did not exist. */
  stored: string | null;
  beforeHash: string | null;
  /** The preimage's permission bits, restored with its bytes. */
  mode?: number;
  afterHash?: string | null;
}

interface CreatedDirectoryEntry {
  kind: "created_directory";
  path: string;
  afterDigest?: string | null;
}

interface MovedDirectoryEntry {
  kind: "moved_directory";
  path: string;
  stored: string;
}

type BackupEntry = FileEntry | CreatedDirectoryEntry | MovedDirectoryEntry;

interface BackupManifest {
  schemaVersion: 1;
  backupId: string;
  effect: EffectBackupKind;
  reason: string;
  createdAt: string;
  state: "taken" | "sealed" | "restored";
  entries: BackupEntry[];
}

export interface EffectBackup {
  backupId: string;
  effect: EffectBackupKind;
}

export interface EffectBackupRestore {
  backupId: string;
  effect: EffectBackupKind;
  restoredPaths: number;
}

/**
 * Bounds what backups keep on disk; a moved derived-state tree keeps only its newest copy. A
 * sealed backup an announced undo names is kept for `EFFECT_BACKUP_RETENTION_DAYS` whatever the
 * count, and every notice names that date.
 */
const MAXIMUM_BACKUPS = 16;
export const EFFECT_BACKUP_RETENTION_DAYS = 30;
const RETENTION_MILLISECONDS = EFFECT_BACKUP_RETENTION_DAYS * 24 * 60 * 60 * 1000;

/** The date until which a backup taken at `createdAt` keeps its announced undo working. */
export function effectBackupKeptUntil(createdAt: Date): string {
  return new Date(createdAt.getTime() + RETENTION_MILLISECONDS).toISOString().slice(0, 10);
}
const MAXIMUM_DIRECTORY_FILES = 4_096;
const BACKUP_ID = /^lbk_[a-f0-9]{24}$/u;

function backupsRoot(repositoryRoot: string): string {
  return resolve(resolveProjectPaths(repositoryRoot).data, "backups");
}

function hash(bytes: Uint8Array): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

async function fileHash(path: string): Promise<string | null> {
  try {
    const stats = await lstat(path);
    if (!stats.isFile())
      throw new CommandFailure("backup_unsafe", "A backed-up path is not a file.");
    return hash(await readFile(path));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

/** A content digest of a directory tree; symbolic links and special files are refused. */
async function directoryDigest(path: string): Promise<string | null> {
  const files: string[] = [];
  const visit = async (current: string): Promise<void> => {
    for (const entry of (await readdir(current, { withFileTypes: true })).sort((left, right) =>
      left.name.localeCompare(right.name),
    )) {
      const child = resolve(current, entry.name);
      if (entry.isDirectory()) await visit(child);
      else if (entry.isFile())
        files.push(`${relative(path, child).split(sep).join("/")}\0${hash(await readFile(child))}`);
      else throw new CommandFailure("backup_unsafe", "A backed-up directory holds a special file.");
      if (files.length > MAXIMUM_DIRECTORY_FILES)
        throw new CommandFailure("backup_unsafe", "A backed-up directory exceeds its file bound.");
    }
  };
  try {
    await visit(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  return hash(Buffer.from(files.join("\n")));
}

function within(root: string, path: string): boolean {
  const relation = relative(root, path);
  return relation !== "" && !relation.startsWith("..") && !relation.startsWith(sep);
}

/** A restore writes only inside the repository or the user's capability root. */
function assertRestorable(repositoryRoot: string, path: string): void {
  if (!within(repositoryRoot, path) && !within(capabilityRoot(repositoryRoot, "user"), path))
    throw new CommandFailure("backup_invalid", "A backup names a path outside its repository.");
}

async function writeManifest(directory: string, manifest: BackupManifest): Promise<void> {
  const path = resolve(directory, "manifest.json");
  await writeFile(`${path}.next`, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
  await rename(`${path}.next`, path);
}

async function readManifest(repositoryRoot: string, backupId: string): Promise<BackupManifest> {
  if (!BACKUP_ID.test(backupId))
    throw new CommandFailure("backup_invalid", "Name a backup by its lbk_ identifier.");
  try {
    const manifest = JSON.parse(
      await readFile(resolve(backupsRoot(repositoryRoot), backupId, "manifest.json"), "utf8"),
    ) as BackupManifest;
    if (manifest.schemaVersion !== 1 || manifest.backupId !== backupId) throw new Error();
    return manifest;
  } catch {
    throw new CommandFailure("backup_missing", `Backup ${backupId} does not exist here.`);
  }
}

/**
 * Keeps the newest backups; only the newest moved tree of each effect stays on disk. A sealed
 * backup younger than the retention window is never pruned, because a notice announced its undo.
 */
async function pruneBackups(repositoryRoot: string, now: Date): Promise<void> {
  const root = backupsRoot(repositoryRoot);
  const manifests: Array<{
    id: string;
    createdAt: string;
    effect: string;
    moved: boolean;
    announced: boolean;
  }> = [];
  for (const id of await readdir(root).catch(() => [] as string[])) {
    if (!BACKUP_ID.test(id)) continue;
    try {
      const manifest = await readManifest(repositoryRoot, id);
      manifests.push({
        id,
        createdAt: manifest.createdAt,
        effect: manifest.effect,
        moved: manifest.entries.some((entry) => entry.kind === "moved_directory"),
        announced:
          manifest.state === "sealed" &&
          now.getTime() - Date.parse(manifest.createdAt) < RETENTION_MILLISECONDS,
      });
    } catch {
      // An unreadable backup is kept for inspection rather than deleted blindly.
    }
  }
  manifests.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  const movedSeen = new Set<string>();
  for (const [index, item] of manifests.entries()) {
    const supersededTree = item.moved && movedSeen.has(item.effect);
    if (item.moved) movedSeen.add(item.effect);
    // A moved derived-state tree's notice says the next reset replaces it.
    if (supersededTree || (index >= MAXIMUM_BACKUPS && !item.announced))
      await rm(resolve(root, item.id), { recursive: true, force: true });
  }
}

/**
 * Takes the backup before an effect: the bytes of each file (or its absence), each directory the
 * effect will create, and each directory the effect removes, which is moved into the backup.
 */
export async function takeEffectBackup(input: {
  repositoryRoot: string;
  effect: EffectBackupKind;
  reason: string;
  files?: readonly string[];
  createdDirectories?: readonly string[];
  movedDirectories?: readonly string[];
  now?: Date;
}): Promise<EffectBackup> {
  const backupId = `lbk_${randomBytes(12).toString("hex")}`;
  const directory = resolve(backupsRoot(input.repositoryRoot), backupId);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const entries: BackupEntry[] = [];
  for (const [index, path] of (input.files ?? []).entries()) {
    const beforeHash = await fileHash(path);
    const stored = beforeHash === null ? null : `file-${index}`;
    if (stored === null) {
      entries.push({ kind: "file", path, stored, beforeHash });
      continue;
    }
    await writeFile(resolve(directory, stored), await readFile(path), { mode: 0o600 });
    entries.push({
      kind: "file",
      path,
      stored,
      beforeHash,
      mode: (await lstat(path)).mode & 0o777,
    });
  }
  for (const path of input.createdDirectories ?? [])
    entries.push({ kind: "created_directory", path });
  for (const [index, path] of (input.movedDirectories ?? []).entries()) {
    const stored = `tree-${index}`;
    await rename(path, resolve(directory, stored));
    entries.push({ kind: "moved_directory", path, stored });
  }
  await writeManifest(directory, {
    schemaVersion: 1,
    backupId,
    effect: input.effect,
    reason: input.reason.slice(0, 400),
    createdAt: (input.now ?? new Date()).toISOString(),
    state: "taken",
    entries,
  });
  await pruneBackups(input.repositoryRoot, input.now ?? new Date());
  return { backupId, effect: input.effect };
}

/** Records what the effect wrote, so a restore refuses to undo a later edit. */
export async function sealEffectBackup(
  repositoryRoot: string,
  backup: EffectBackup,
): Promise<void> {
  const manifest = await readManifest(repositoryRoot, backup.backupId);
  const entries: BackupEntry[] = [];
  for (const entry of manifest.entries)
    entries.push(
      entry.kind === "file"
        ? { ...entry, afterHash: await fileHash(entry.path) }
        : entry.kind === "created_directory"
          ? { ...entry, afterDigest: await directoryDigest(entry.path) }
          : entry,
    );
  await writeManifest(resolve(backupsRoot(repositoryRoot), backup.backupId), {
    ...manifest,
    state: "sealed",
    entries,
  });
}

/**
 * Restores a backup. Every file and created directory must still hold what the effect wrote, or
 * the restore fails with `restore_conflict` and changes nothing. A moved derived-state tree
 * replaces the current derived state, which is rebuildable.
 */
export async function restoreEffectBackup(input: {
  repositoryRoot: string;
  backupId: string;
}): Promise<EffectBackupRestore> {
  const manifest = await readManifest(input.repositoryRoot, input.backupId);
  if (manifest.state === "restored")
    throw new CommandFailure("restore_conflict", `Backup ${input.backupId} was already restored.`);
  const directory = resolve(backupsRoot(input.repositoryRoot), input.backupId);
  for (const entry of manifest.entries) {
    assertRestorable(input.repositoryRoot, entry.path);
    const changed =
      entry.kind === "file"
        ? entry.afterHash !== undefined && (await fileHash(entry.path)) !== entry.afterHash
        : entry.kind === "created_directory"
          ? entry.afterDigest !== undefined &&
            (await directoryDigest(entry.path)) !== entry.afterDigest
          : false;
    if (changed)
      throw new CommandFailure(
        "restore_conflict",
        `A path in backup ${input.backupId} changed after Lervo wrote it, so nothing was restored.`,
      );
  }
  for (const entry of manifest.entries) {
    if (entry.kind === "file") {
      if (entry.stored === null) await rm(entry.path, { force: true });
      else {
        await mkdir(dirname(entry.path), { recursive: true });
        const next = `${entry.path}.lervo-restore`;
        await writeFile(next, await readFile(resolve(directory, entry.stored)));
        await chmod(next, entry.mode ?? 0o644);
        await rename(next, entry.path);
      }
    } else if (entry.kind === "created_directory") {
      await rm(entry.path, { recursive: true, force: true });
    } else {
      const replaced = `${entry.path}.lervo-restore-${input.backupId}`;
      await rename(entry.path, replaced).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== "ENOENT") throw error;
      });
      await rename(resolve(directory, entry.stored), entry.path);
      await rm(replaced, { recursive: true, force: true });
    }
  }
  await writeManifest(directory, { ...manifest, state: "restored" });
  return {
    backupId: input.backupId,
    effect: manifest.effect,
    restoredPaths: manifest.entries.length,
  };
}

/** The one command that undoes a backed-up effect. */
export function effectBackupUndoCommand(backupId: string): string {
  return `lervo state restore ${backupId}`;
}
