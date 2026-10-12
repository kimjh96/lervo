import { constants } from "node:fs";
import { lstat, mkdir, open } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { openSqliteDatabase } from "@lervo/sqlite-connection";
import { NodeWorkAdmissionError } from "./contract.js";

type Row = Record<string, unknown>;
async function ensureDatabasePath(path: string): Promise<string> {
  if (!isAbsolute(path) || path.includes("\0")) {
    throw new NodeWorkAdmissionError("admission_invalid", "The admission path is invalid.");
  }
  const absolute = resolve(path);
  const directory = dirname(absolute);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const parent = await lstat(directory);
  if (
    !parent.isDirectory() ||
    parent.isSymbolicLink() ||
    (process.getuid !== undefined &&
      (parent.uid !== process.getuid() || (parent.mode & 0o022) !== 0))
  ) {
    throw new NodeWorkAdmissionError("admission_invalid", "The admission directory is unsafe.");
  }
  try {
    const handle = await open(
      absolute,
      constants.O_CREAT | constants.O_EXCL | constants.O_RDWR | (constants.O_NOFOLLOW ?? 0),
      0o600,
    );
    await handle.close();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  const file = await lstat(absolute);
  if (
    !file.isFile() ||
    file.isSymbolicLink() ||
    file.nlink !== 1 ||
    (process.getuid !== undefined && (file.uid !== process.getuid() || (file.mode & 0o077) !== 0))
  ) {
    throw new NodeWorkAdmissionError("admission_invalid", "The admission file is unsafe.");
  }
  return absolute;
}

export async function openAdmissionDatabase(path: string): Promise<DatabaseSync> {
  const database = openSqliteDatabase(await ensureDatabasePath(path), { busyTimeoutMs: 100 });
  try {
    database.exec(`
        PRAGMA journal_mode = WAL;
        PRAGMA synchronous = FULL;
        PRAGMA foreign_keys = ON;
      `);
    database.exec("BEGIN IMMEDIATE;");
    try {
      const version = (database.prepare("PRAGMA user_version;").get() as Row | undefined)
        ?.user_version;
      if (version !== 0 && version !== 1) {
        throw new NodeWorkAdmissionError(
          "admission_invalid",
          "The admission schema is unsupported.",
        );
      }
      if (version === 0) {
        database.exec(`
            CREATE TABLE node_work_scope (
              scope TEXT PRIMARY KEY,
              config_digest TEXT NOT NULL,
              freeze_token TEXT,
              freeze_pid INTEGER,
              CHECK ((freeze_token IS NULL) = (freeze_pid IS NULL))
            ) STRICT;
            CREATE TABLE node_work_session (
              token TEXT PRIMARY KEY,
              scope TEXT NOT NULL REFERENCES node_work_scope(scope),
              owner_pid INTEGER NOT NULL CHECK (owner_pid > 0)
            ) STRICT;
            CREATE INDEX node_work_session_scope ON node_work_session(scope);
            CREATE TABLE node_work_claim (
              token TEXT PRIMARY KEY,
              session_token TEXT NOT NULL REFERENCES node_work_session(token) ON DELETE CASCADE
            ) STRICT;
            CREATE INDEX node_work_claim_session ON node_work_claim(session_token);
            PRAGMA user_version = 1;
          `);
      }
      for (const [table, column] of [
        ["node_work_session", "owner_identity"],
        ["node_work_scope", "freeze_identity"],
      ]) {
        const columns = database.prepare(`PRAGMA table_info(${table})`).all() as Row[];
        if (!columns.some((row) => row.name === column))
          database.exec(`ALTER TABLE ${table} ADD COLUMN ${column} TEXT`);
      }
      database.exec("COMMIT;");
    } catch (error) {
      database.exec("ROLLBACK;");
      throw error;
    }
    return database;
  } catch (error) {
    database.close();
    throw error;
  }
}
