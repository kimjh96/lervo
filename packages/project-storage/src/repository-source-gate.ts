import { constants } from "node:fs";
import { lstat, mkdir, open } from "node:fs/promises";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { resolveProjectPaths } from "@lervo/project";

const DATABASE_NAME = "repository-source-gate.sqlite";
const MATERIALIZATION_TRANSACTION = ".lervo/state/knowledge/materialization-transaction";

export class RepositorySourceGateError extends Error {
  constructor(
    readonly code:
      "repository_source_busy" | "repository_source_gate_invalid" | "knowledge_recovery_required",
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "RepositorySourceGateError";
  }
}

export interface RepositorySourceLease {
  release(): void;
}

function busy(error: unknown): boolean {
  const code = (error as { errcode?: unknown } | null)?.errcode;
  return typeof code === "number" && [5, 6].includes(code & 0xff);
}

async function requireSafeDirectory(path: string): Promise<void> {
  const stat = await lstat(path);
  if (
    !stat.isDirectory() ||
    stat.isSymbolicLink() ||
    (process.getuid !== undefined && (stat.uid !== process.getuid() || (stat.mode & 0o022) !== 0))
  )
    throw new RepositorySourceGateError(
      "repository_source_gate_invalid",
      "The repository source gate directory is unsafe.",
    );
}

async function databasePath(repositoryRoot: string): Promise<string> {
  const paths = resolveProjectPaths(repositoryRoot);
  await requireSafeDirectory(paths.repositoryRoot);
  await requireSafeDirectory(paths.lervoRoot);
  await mkdir(paths.data, { recursive: true, mode: 0o700 });
  await requireSafeDirectory(paths.data);
  const path = resolve(paths.data, DATABASE_NAME);
  try {
    const handle = await open(
      path,
      constants.O_CREAT | constants.O_EXCL | constants.O_RDWR | (constants.O_NOFOLLOW ?? 0),
      0o600,
    );
    await handle.close();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  const stat = await lstat(path);
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    stat.nlink !== 1 ||
    (process.getuid !== undefined && (stat.uid !== process.getuid() || (stat.mode & 0o077) !== 0))
  )
    throw new RepositorySourceGateError(
      "repository_source_gate_invalid",
      "The repository source gate file is unsafe.",
    );
  return path;
}

function initialize(database: DatabaseSync): void {
  database.exec("PRAGMA busy_timeout = 100;");
  if (database.prepare("PRAGMA journal_mode").get()?.journal_mode !== "delete")
    throw new RepositorySourceGateError(
      "repository_source_gate_invalid",
      "The repository source gate requires rollback journaling.",
    );
  const version = Number(database.prepare("PRAGMA user_version").get()?.user_version);
  if (version === 1) {
    if (
      database.prepare("SELECT marker FROM repository_source_gate WHERE id = 1").get()?.marker !== 1
    )
      throw new RepositorySourceGateError(
        "repository_source_gate_invalid",
        "The repository source gate marker is invalid.",
      );
    return;
  }
  if (version !== 0)
    throw new RepositorySourceGateError(
      "repository_source_gate_invalid",
      "The repository source gate schema is unsupported.",
    );
  database.exec("BEGIN EXCLUSIVE");
  try {
    database.exec(`
      CREATE TABLE IF NOT EXISTS repository_source_gate (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        marker INTEGER NOT NULL CHECK (marker = 1)
      ) STRICT;
      INSERT OR IGNORE INTO repository_source_gate VALUES (1, 1);
      PRAGMA user_version = 1;
    `);
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

async function assertNoInterruptedMaterialization(repositoryRoot: string): Promise<void> {
  try {
    const stat = await lstat(resolve(repositoryRoot, MATERIALIZATION_TRANSACTION));
    if (!stat.isDirectory() || stat.isSymbolicLink())
      throw new RepositorySourceGateError(
        "repository_source_gate_invalid",
        "The knowledge materialization marker is unsafe.",
      );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  throw new RepositorySourceGateError(
    "knowledge_recovery_required",
    "An interrupted knowledge materialization must be recovered before repository work.",
  );
}

async function acquire(
  repositoryRoot: string,
  mode: "read" | "write",
): Promise<RepositorySourceLease> {
  let database: DatabaseSync | undefined;
  try {
    database = new DatabaseSync(await databasePath(repositoryRoot), { allowExtension: false });
    initialize(database);
    database.exec(mode === "read" ? "BEGIN" : "BEGIN EXCLUSIVE");
    if (
      database.prepare("SELECT marker FROM repository_source_gate WHERE id = 1").get()?.marker !== 1
    )
      throw new Error("The repository source gate marker changed.");
    if (mode === "read") await assertNoInterruptedMaterialization(repositoryRoot);
    const held = database;
    database = undefined;
    let released = false;
    return {
      release() {
        if (released) return;
        released = true;
        try {
          held.exec("ROLLBACK");
        } finally {
          held.close();
        }
      },
    };
  } catch (error) {
    if (database !== undefined) {
      try {
        database.exec("ROLLBACK");
      } catch {
        // A failed acquisition may not have opened a transaction.
      }
      database.close();
    }
    if (error instanceof RepositorySourceGateError) throw error;
    throw new RepositorySourceGateError(
      busy(error) ? "repository_source_busy" : "repository_source_gate_invalid",
      busy(error)
        ? "Another repository source operation is active."
        : "The repository source gate could not be acquired safely.",
      { cause: error },
    );
  }
}

/** Shared readers allow live turns; an exclusive writer covers a complete durable materialization. */
export function acquireRepositorySourceRead(
  repositoryRoot: string,
): Promise<RepositorySourceLease> {
  return acquire(repositoryRoot, "read");
}

export function acquireRepositorySourceWrite(
  repositoryRoot: string,
): Promise<RepositorySourceLease> {
  return acquire(repositoryRoot, "write");
}
