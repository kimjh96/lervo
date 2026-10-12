import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";

import { SQLiteEventStore } from "../src/index.js";

const projectId = "prj_atomic_setup";
const roots: string[] = [];

async function pathForStore() {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-atomic-setup-"));
  roots.push(root);
  return resolve(root, "events.sqlite");
}

function edit(path: string, sql: string) {
  const database = new DatabaseSync(path);
  try {
    database.exec(sql);
  } finally {
    database.close();
  }
}

function snapshot(path: string) {
  const database = new DatabaseSync(path, { readOnly: true });
  try {
    const schema = database
      .prepare("SELECT type, name, sql FROM sqlite_master ORDER BY type, name")
      .all();
    const hasMetadata = schema.some(
      (row) =>
        typeof row === "object" && row !== null && "name" in row && row.name === "store_meta",
    );
    return {
      version: database.prepare("PRAGMA user_version").get(),
      schema,
      metadata: hasMetadata
        ? database.prepare("SELECT key, value FROM store_meta ORDER BY key").all()
        : [],
    };
  } finally {
    database.close();
  }
}

async function olderStore() {
  const path = await pathForStore();
  const store = await SQLiteEventStore.open({ path, projectId });
  store.close();
  edit(
    path,
    `DROP INDEX events_one_work_causality_per_run;
     DROP INDEX events_one_root_per_work;
     DROP INDEX events_type_seq;
     PRAGMA user_version = 2;
     UPDATE store_meta SET value = '2' WHERE key = 'storage_schema_version';`,
  );
  return path;
}

async function verifyRecovery(path: string) {
  const store = await SQLiteEventStore.open({ path, projectId });
  try {
    expect(store.verifyIntegrity().valid).toBe(true);
  } finally {
    store.close();
  }
  expect(snapshot(path).version).toMatchObject({ user_version: 3 });
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("atomic schema initialization and project binding", () => {
  it("rolls back schema and index upgrades when the project binding conflicts", async () => {
    const path = await olderStore();
    const before = snapshot(path);
    await expect(
      SQLiteEventStore.open({ path, projectId: "prj_other_project" }),
    ).rejects.toMatchObject({ code: "project_mismatch" });
    expect(snapshot(path)).toEqual(before);
    await verifyRecovery(path);
  });

  it("rolls back migrations when stored metadata has an unsupported version", async () => {
    const path = await olderStore();
    edit(path, "UPDATE store_meta SET value = '99' WHERE key = 'storage_schema_version'");
    const before = snapshot(path);
    await expect(SQLiteEventStore.open({ path, projectId })).rejects.toMatchObject({
      code: "integrity_failed",
    });
    expect(snapshot(path)).toEqual(before);
    edit(path, "UPDATE store_meta SET value = '2' WHERE key = 'storage_schema_version'");
    await verifyRecovery(path);
  });

  it("rolls back new tables and partial metadata when project insertion fails", async () => {
    const path = await pathForStore();
    edit(
      path,
      `CREATE TABLE store_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL CHECK (key <> 'project_id')
      ) STRICT;`,
    );
    const before = snapshot(path);
    await expect(SQLiteEventStore.open({ path, projectId })).rejects.toThrow(/CHECK constraint/);
    expect(snapshot(path)).toEqual(before);
    edit(path, "DROP TABLE store_meta");
    await verifyRecovery(path);
  });

  it("rolls back earlier migration steps when a later step fails and releases its lock", async () => {
    const path = await pathForStore();
    edit(path, "CREATE VIEW outbox AS SELECT 1 AS incompatible");
    const before = snapshot(path);
    await expect(SQLiteEventStore.open({ path, projectId })).rejects.toThrow(/already exists/);
    expect(snapshot(path)).toEqual(before);
    edit(path, "DROP VIEW outbox");
    await verifyRecovery(path);
  });
});
