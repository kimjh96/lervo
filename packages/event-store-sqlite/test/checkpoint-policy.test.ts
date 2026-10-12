import { access, mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { randomBytes } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { afterEach, expect, it, vi } from "vitest";
import { SQLiteEventStore, type OpenEventStoreOptions } from "../src/index.js";
import { sqliteRow } from "../src/sqlite-row.js";

const roots: string[] = [];
const stores: SQLiteEventStore[] = [];
const projectId = "prj_checkpoint";
afterEach(async () => {
  vi.restoreAllMocks();
  for (const store of stores.splice(0)) store.close();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function path() {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-checkpoint-"));
  roots.push(root);
  return resolve(root, "events.sqlite");
}
async function open(options: Partial<OpenEventStoreOptions> = {}) {
  const store = await SQLiteEventStore.open({ path: await path(), projectId, ...options });
  stores.push(store);
  return store;
}
function publish(store: SQLiteEventStore, bytes = randomBytes(64 * 1024)) {
  return { bytes, ...store.reportWriter!.transact((tx) => tx.putReport(bytes)) };
}

it("selects the report interval only for an explicitly selected format-4 writer", async () => {
  const exec = DatabaseSync.prototype.exec;
  const observed: number[] = [];
  vi.spyOn(DatabaseSync.prototype, "exec").mockImplementation(function (this: DatabaseSync, sql) {
    if (sql === "COMMIT;")
      observed.push(
        Number(sqliteRow(this.prepare("PRAGMA wal_autocheckpoint").get())?.wal_autocheckpoint),
      );
    return exec.call(this, sql);
  });
  await open();
  await open({ checkpointEachCommit: true });
  await open({ checkpointPolicy: "each_commit" });
  const legacy = await open({
    checkpointPolicy: "report_batches",
    reportStorage: "existing_sqlite_v1",
    writableEventSchemaVersion: 6,
  });
  expect(legacy.reportWriter).toBeUndefined();
  const selected = await open({
    checkpointPolicy: "report_batches",
    reportStorage: "sqlite_v1",
    writableEventSchemaVersion: 6,
  });
  expect(selected.reportWriter).toBeDefined();
  await open({
    path: selected.path,
    checkpointPolicy: "report_batches",
    writableEventSchemaVersion: 6,
  });
  await open({
    path: selected.path,
    checkpointPolicy: "report_batches",
    reportStorage: "existing_sqlite_v1",
    writableEventSchemaVersion: 6,
  });
  expect(observed).toEqual([1000, 1, 1, 1, 512, 1, 512]);
});

it("rejects invalid or conflicting policy before creating the database", async () => {
  for (const options of [
    { checkpointPolicy: "invalid" as "report_batches" },
    { checkpointPolicy: "report_batches" as const, checkpointEachCommit: false },
    { checkpointPolicy: "each_commit" as const, checkpointEachCommit: true },
  ]) {
    const databasePath = await path();
    await expect(open({ path: databasePath, ...options })).rejects.toMatchObject({
      code: "integrity_failed",
    });
    await expect(access(databasePath)).rejects.toMatchObject({ code: "ENOENT" });
  }
});

it("fails closed and rolls back initialization when policy readback disagrees", async () => {
  const exec = DatabaseSync.prototype.exec;
  vi.spyOn(DatabaseSync.prototype, "exec").mockImplementation(function (this: DatabaseSync, sql) {
    if (sql.includes("PRAGMA wal_autocheckpoint = 512")) return;
    return exec.call(this, sql);
  });
  const databasePath = await path();
  await expect(
    open({
      path: databasePath,
      checkpointPolicy: "report_batches",
      reportStorage: "sqlite_v1",
      writableEventSchemaVersion: 6,
    }),
  ).rejects.toMatchObject({ code: "integrity_failed" });
  const db = new DatabaseSync(databasePath);
  try {
    expect(sqliteRow(db.prepare("PRAGMA user_version").get())?.user_version).toBe(0);
    expect(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all()).toHaveLength(0);
  } finally {
    db.close();
  }
});

it("retains strong report commits and recycles WAL without losing complete reports", async () => {
  const store = await open({
    checkpointPolicy: "report_batches",
    reportStorage: "sqlite_v1",
    writableEventSchemaVersion: 6,
  });
  const exec = DatabaseSync.prototype.exec;
  const settings: unknown[] = [];
  vi.spyOn(DatabaseSync.prototype, "exec").mockImplementation(function (this: DatabaseSync, sql) {
    if (sql === "COMMIT;")
      settings.push(
        [
          "synchronous",
          "fullfsync",
          "checkpoint_fullfsync",
          "wal_autocheckpoint",
          "journal_size_limit",
        ].map((key) => sqliteRow(this.prepare(`PRAGMA ${key}`).get())?.[key]),
      );
    return exec.call(this, sql);
  });
  const reports = [];
  const sizes: number[] = [];
  for (let i = 0; i < 24; i++) {
    reports.push(publish(store));
    sizes.push((await stat(store.path + "-wal")).size);
  }
  expect(settings).toEqual(Array.from({ length: 24 }, () => [2, 1, 1, 512, 0]));
  expect(sizes.some((size, i) => i > 0 && size < sizes[i - 1]!)).toBe(true);
  expect(Math.max(...sizes)).toBeLessThan(2 * 1024 * 1024);
  store.close();
  await expect(access(store.path + "-wal")).rejects.toMatchObject({ code: "ENOENT" });
  const reader = await SQLiteEventStore.openReadOnly({ path: store.path, projectId });
  stores.push(reader);
  for (const report of reports)
    expect(reader.reports.getReport(report.contentHash)).toEqual(report.bytes);
  expect(reader.verifyIntegrity().valid).toBe(true);
});

it("preserves an active reader snapshot and reclaims its retained WAL after reader release", async () => {
  const store = await open({
    checkpointPolicy: "report_batches",
    reportStorage: "sqlite_v1",
    writableEventSchemaVersion: 6,
  });
  const first = publish(store);
  const reader = new DatabaseSync(store.path, { readOnly: true });
  try {
    reader.exec("BEGIN;");
    expect(sqliteRow(reader.prepare("SELECT count(*) AS n FROM quality_reports").get())?.n).toBe(1);
    for (let i = 0; i < 20; i++) publish(store);
    const held = (await stat(store.path + "-wal")).size;
    expect(held).toBeGreaterThan(256 * 4096);
    expect(sqliteRow(reader.prepare("SELECT count(*) AS n FROM quality_reports").get())?.n).toBe(1);
    expect(store.reports.getReport(first.contentHash)).toEqual(first.bytes);
    reader.exec("COMMIT;");
    publish(store);
    publish(store);
    expect((await stat(store.path + "-wal")).size).toBeLessThan(held);
    expect(store.verifyIntegrity().valid).toBe(true);
  } finally {
    reader.close();
  }
  store.close();
  await expect(access(store.path + "-wal")).rejects.toMatchObject({ code: "ENOENT" });
});

it("uses compact pages only for empty selected stores and preserves an existing layout", async () => {
  const empty = await open({ reportStorage: "sqlite_v1", writableEventSchemaVersion: 6 });
  const existing = await open();
  await open({ path: existing.path, reportStorage: "sqlite_v1", writableEventSchemaVersion: 6 });
  for (const [store, size] of [
    [empty, 2048],
    [existing, 4096],
  ] as const) {
    const db = new DatabaseSync(store.path);
    try {
      expect(sqliteRow(db.prepare("PRAGMA page_size").get())?.page_size).toBe(size);
    } finally {
      db.close();
    }
  }
  const reopened = await open({
    path: empty.path,
    reportStorage: "existing_sqlite_v1",
    writableEventSchemaVersion: 6,
    checkpointPolicy: "report_batches",
  });
  const report = publish(reopened);
  expect(reopened.reports.getReport(report.contentHash)).toEqual(report.bytes);
});
