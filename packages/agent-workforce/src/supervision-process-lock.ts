import { createHash } from "node:crypto";
import { lstatSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

function fileIdentity(path: string): string {
  const info = lstatSync(path, { bigint: true });
  if (
    !info.isFile() ||
    info.nlink !== 1n ||
    info.size > 65536n ||
    (process.platform !== "win32" &&
      ((info.mode & 0o077n) !== 0n || info.uid !== BigInt(process.getuid!())))
  )
    throw new Error("The supervision process lock is unsafe.");
  return `${info.dev}:${info.ino}`;
}

function isAlreadyClosed(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | null)?.code === "ERR_INVALID_STATE";
}

/**
 * SQLite releases this supervision identity's lock when its owning process dies.
 *
 * Handle and transaction state are tracked here instead of read from `DatabaseSync.isOpen` and
 * `isTransaction`, which the supported Node 22.13 baseline does not provide.
 */
export class SupervisionProcessLock {
  private database: DatabaseSync | null = null;
  private transactionOpen = false;
  private readonly directory: string;
  private readonly path: string;

  constructor(databasePath: string, supervisionId: string) {
    this.directory = `${databasePath}.owner-locks`;
    this.path = resolve(this.directory, createHash("sha256").update(supervisionId).digest("hex"));
  }

  identity(): string {
    return fileIdentity(this.path);
  }

  acquire(): string | null {
    if (this.database !== null) return null;
    mkdirSync(this.directory, { mode: 0o700, recursive: true });
    const directory = lstatSync(this.directory);
    if (
      !directory.isDirectory() ||
      directory.isSymbolicLink() ||
      (process.platform !== "win32" &&
        ((directory.mode & 0o077) !== 0 || directory.uid !== process.getuid?.()))
    )
      throw new Error("The supervision process lock directory is unsafe.");
    // The lease database transaction serializes allocation. Bound orphan files from crashes too.
    try {
      lstatSync(this.path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      if (readdirSync(this.directory).filter((name) => /^[a-f0-9]{64}$/u.test(name)).length >= 4096)
        throw new Error("The supervision process lock directory is full.", { cause: error });
    }
    try {
      writeFileSync(this.path, "", { flag: "wx", mode: 0o600 });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    const identity = this.identity();
    for (const suffix of ["-journal", "-wal", "-shm"]) {
      try {
        fileIdentity(`${this.path}${suffix}`);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
    const database = new DatabaseSync(this.path, { allowExtension: false });
    try {
      database.exec("PRAGMA busy_timeout = 0; BEGIN IMMEDIATE;");
      if (this.identity() !== identity) throw new Error("The supervision process lock changed.");
      this.database = database;
      this.transactionOpen = true;
      return identity;
    } catch (error) {
      database.close();
      if (
        error instanceof Error &&
        "errcode" in error &&
        [5, 6].includes(Number(error.errcode) & 0xff)
      )
        return null;
      throw error;
    }
  }

  release(): void {
    const database = this.database;
    if (database === null) return;
    try {
      if (this.transactionOpen) {
        database.exec("ROLLBACK");
        this.transactionOpen = false;
      }
    } finally {
      this.close(database);
    }
  }

  /** Retains the handle when a native close fails so a later release can retry it. */
  private close(database: DatabaseSync): void {
    try {
      database.close();
    } catch (error) {
      if (!isAlreadyClosed(error)) throw error;
    }
    this.database = null;
    this.transactionOpen = false;
  }
}
