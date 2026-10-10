import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { DatabaseSync, type StatementSync } from "node:sqlite";

import { ModuleKind, ScriptTarget, transpileModule } from "typescript";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { InteractionSQLiteError } from "../src/errors.js";
import { sqliteRow, sqliteRows, iterateSqliteRows } from "../src/sqlite-row.js";

describe("SQLite row narrowing", () => {
  let database: DatabaseSync;

  beforeEach(() => {
    database = new DatabaseSync(":memory:");
    database.exec(
      "CREATE TABLE items (value INTEGER NOT NULL); INSERT INTO items VALUES (1), (2);",
    );
  });

  afterEach(() => {
    database.close();
  });

  it("keeps a matched get() row and reports a missing row as undefined", () => {
    expect(sqliteRow(database.prepare("SELECT value FROM items WHERE value = ?").get(2))).toEqual({
      value: 2,
    });
    expect(sqliteRow(database.prepare("SELECT value FROM items WHERE value = ?").get(3))).toBe(
      undefined,
    );
  });

  it("rejects a value that is not a row object with a coded integrity error", () => {
    for (const value of [null, 1, "row", [1]]) {
      expect(() => sqliteRow(value)).toThrow(InteractionSQLiteError);
      expect(() => sqliteRow(value)).toThrow(expect.objectContaining({ code: "integrity_failed" }));
    }
  });

  it("narrows every row of an all() result", () => {
    expect(sqliteRows(database.prepare("SELECT value FROM items ORDER BY value").all())).toEqual([
      { value: 1 },
      { value: 2 },
    ]);
    expect(() => sqliteRows([{ value: 1 }, 7])).toThrow(
      expect.objectContaining({ name: "InteractionSQLiteError", code: "integrity_failed" }),
    );
  });

  it("narrows iterate() rows lazily", () => {
    const rows = iterateSqliteRows(database.prepare("SELECT value FROM items ORDER BY value"));
    expect(rows.next().value).toEqual({ value: 1 });
    expect(rows.return()).toEqual({ done: true, value: undefined });
    expect(() => [
      ...iterateSqliteRows({ iterate: () => ["row"][Symbol.iterator]() } as unknown as Pick<
        StatementSync,
        "iterate"
      >),
    ]).toThrow(InteractionSQLiteError);
  });

  it("retains live statements across GC and releases an interrupted cursor", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "lervo-sqlite-iteration-"));
    try {
      for (const name of ["sqlite-row", "errors"]) {
        const source = await readFile(new URL(`../src/${name}.ts`, import.meta.url), "utf8");
        const compiled = transpileModule(source, {
          compilerOptions: { target: ScriptTarget.ES2022, module: ModuleKind.ESNext },
        });
        await writeFile(resolve(root, `${name}.js`), compiled.outputText);
      }
      await writeFile(resolve(root, "package.json"), JSON.stringify({ type: "module" }));
      const result = spawnSync(process.execPath, ["--expose-gc", "--input-type=module", "-"], {
        encoding: "utf8",
        timeout: 15_000,
        input: `
          import assert from 'node:assert/strict';
          import { DatabaseSync } from 'node:sqlite';
          import { setImmediate } from 'node:timers/promises';
          import { iterateSqliteRows } from ${JSON.stringify(pathToFileURL(resolve(root, "sqlite-row.js")).href)};
          const database = new DatabaseSync(':memory:');
          database.exec('CREATE TABLE items(value); INSERT INTO items VALUES (1), (2), (3)');
          const collect = async () => { await setImmediate(); gc(); await setImmediate(); gc(); };
          try {
            const rows = iterateSqliteRows(database.prepare('SELECT value FROM items WHERE value >= ? ORDER BY value'), 2);
            await collect();
            assert.deepEqual({...rows.next().value}, {value: 2});
            await collect();
            assert.deepEqual({...rows.next().value}, {value: 3});
            await collect();
            assert.equal(rows.next().done, true);
            const interrupted = iterateSqliteRows(database.prepare('SELECT value FROM items'));
            assert.equal(interrupted.next().done, false);
            await collect();
            interrupted.return();
            database.exec('DROP TABLE items');
            console.log('sqlite-iterator-lifetime-passed');
          } finally { database.close(); }
        `,
      });
      expect(result.error).toBeUndefined();
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout.trim()).toBe("sqlite-iterator-lifetime-passed");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
