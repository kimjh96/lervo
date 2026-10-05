import { DatabaseSync } from "node:sqlite";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { HubSyncStoreError } from "../src/errors.js";
import { sqliteRow, sqliteRows } from "../src/sqlite-row.js";

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
      expect(() => sqliteRow(value)).toThrow(HubSyncStoreError);
      expect(() => sqliteRow(value)).toThrow(expect.objectContaining({ code: "integrity_failed" }));
    }
  });

  it("narrows every row of an all() result", () => {
    expect(sqliteRows(database.prepare("SELECT value FROM items ORDER BY value").all())).toEqual([
      { value: 1 },
      { value: 2 },
    ]);
    expect(() => sqliteRows([{ value: 1 }, 7])).toThrow(
      expect.objectContaining({ name: "HubSyncStoreError", code: "integrity_failed" }),
    );
  });
});
