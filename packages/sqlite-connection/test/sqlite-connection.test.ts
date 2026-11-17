import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  isSqliteLockContention,
  openSqliteDatabase,
  SQLITE_BUSY_TIMEOUT_MS,
} from "../src/index.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function walDatabase(): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-sqlite-connection-"));
  roots.push(root);
  const path = resolve(root, "store.sqlite");
  const database = new DatabaseSync(path);
  database.exec("PRAGMA journal_mode = WAL; CREATE TABLE items (value INTEGER);");
  database.close();
  return path;
}

/** Another process holds the database exclusively, as a recovering or migrating opener can. */
async function holdExclusively(
  path: string,
  milliseconds: number,
): Promise<{ released: Promise<void> }> {
  const holder = spawn(process.execPath, [
    "-e",
    `const { DatabaseSync } = require("node:sqlite");
     const database = new DatabaseSync(${JSON.stringify(path)});
     database.exec("PRAGMA locking_mode = EXCLUSIVE; BEGIN EXCLUSIVE; INSERT INTO items VALUES (1);");
     process.stdout.write("held\\n");
     setTimeout(() => { database.exec("COMMIT"); database.close(); }, ${milliseconds});`,
  ]);
  await new Promise((ready) => holder.stdout.once("data", ready));
  // Wrapped so that awaiting the hold does not also await its release.
  return { released: new Promise((released) => holder.once("exit", () => released())) };
}

function thrown(statement: () => unknown): unknown {
  try {
    statement();
  } catch (error) {
    return error;
  }
  throw new Error("The statement did not fail.");
}

describe("SQLite connection opening", () => {
  it("waits for another process's lock before the first statement that needs it", async () => {
    const path = await walDatabase();
    const { released } = await holdExclusively(path, 300);
    const started = Date.now();
    const database = openSqliteDatabase(path, { busyTimeoutMs: SQLITE_BUSY_TIMEOUT_MS });
    database.exec("PRAGMA journal_mode = WAL;");
    expect(database.prepare("SELECT count(*) AS count FROM items").get()).toEqual({ count: 1 });
    expect(Date.now() - started).toBeGreaterThanOrEqual(200);
    database.close();
    await released;
  });

  it("fails at once on a held lock when no wait is configured", async () => {
    const path = await walDatabase();
    const { released } = await holdExclusively(path, 300);
    const database = openSqliteDatabase(path, { busyTimeoutMs: 0 });
    const locked = thrown(() => database.exec("PRAGMA journal_mode = WAL;"));
    expect(locked).toMatchObject({ message: expect.stringMatching(/locked/u) });
    expect(isSqliteLockContention(locked)).toBe(true);
    await released;
    const missing = thrown(() => database.exec("SELECT * FROM missing"));
    expect(missing).toMatchObject({ message: expect.stringMatching(/no such table/u) });
    expect(isSqliteLockContention(missing)).toBe(false);
    expect(isSqliteLockContention(new Error("database is locked"))).toBe(false);
    database.close();
  });

  it("applies connection options and rejects an invalid wait", async () => {
    const path = await walDatabase();
    const database = openSqliteDatabase(path, { busyTimeoutMs: 1234, readOnly: true });
    expect(database.prepare("PRAGMA busy_timeout").get()).toEqual({ timeout: 1234 });
    expect(() => database.exec("INSERT INTO items VALUES (2)")).toThrow(/readonly/u);
    database.close();
    for (const busyTimeoutMs of [-1, 1.5, 60_001, Number.NaN])
      expect(() => openSqliteDatabase(path, { busyTimeoutMs })).toThrow(RangeError);
  });
});
