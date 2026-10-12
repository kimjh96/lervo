import { chmod, lstat, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, expect, it } from "vitest";
import { SQLiteEventStore, inspectExistingEventStore } from "../src/index.js";
import { SQLiteReportRepository } from "../src/report-repository.js";

const roots: string[] = [];
const projectId = "prj_report_reader";
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function pathForStore() {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-report-reader-"));
  roots.push(root);
  return resolve(root, "events.sqlite");
}
function edit<T>(path: string, work: (database: DatabaseSync) => T): T {
  const database = new DatabaseSync(path);
  try {
    return work(database);
  } finally {
    database.close();
  }
}
function seed(path: string, bytes: Uint8Array) {
  return edit(path, (database) => {
    database.exec("BEGIN IMMEDIATE");
    try {
      const reports = new SQLiteReportRepository(
        database,
        () => {},
        () => {},
      );
      const report = reports.insert(bytes);
      database.exec("COMMIT");
      return report;
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  });
}

it("keeps default stores at format 3 and requires explicit version-6 report selection", async () => {
  const path = await pathForStore();
  const store = await SQLiteEventStore.open({ path, projectId });
  expect(store.reports.getReport("sha256:" + "0".repeat(64))).toBeNull();
  store.close();
  expect(edit(path, (db) => db.prepare("PRAGMA user_version").get())).toMatchObject({
    user_version: 3,
  });
  await expect(
    SQLiteEventStore.open({ path, projectId, reportStorage: "sqlite_v1" }),
  ).rejects.toMatchObject({ code: "event_schema_unsupported" });
});

it("reads complete reports after restart through ordinary and read-only handles", async () => {
  const path = await pathForStore();
  (
    await SQLiteEventStore.open({
      path,
      projectId,
      writableEventSchemaVersion: 6,
      reportStorage: "sqlite_v1",
    })
  ).close();
  const bytes = Buffer.from("complete private report");
  const report = seed(path, bytes);
  for (const open of [SQLiteEventStore.open, SQLiteEventStore.openReadOnly]) {
    const store = await open({ path, projectId });
    expect(store.reports.getReport(report.contentHash)).toEqual(bytes);
    expect(store.verifyIntegrity().valid).toBe(true);
    store.close();
    expect(() => store.reports.getReport(report.contentHash)).toThrowError(
      expect.objectContaining({ code: "closed" }),
    );
  }
  (await SQLiteEventStore.open({ path, projectId })).close();
  expect(await inspectExistingEventStore({ path, projectId })).toMatchObject({
    storageSchemaVersion: 4,
    requiresSchemaMigration: false,
  });
});

it("rolls back format activation and metadata on a project conflict", async () => {
  const path = await pathForStore();
  (await SQLiteEventStore.open({ path, projectId })).close();
  await expect(
    SQLiteEventStore.open({
      path,
      projectId: "prj_wrong_report",
      writableEventSchemaVersion: 6,
      reportStorage: "sqlite_v1",
    }),
  ).rejects.toMatchObject({ code: "project_mismatch" });
  expect(edit(path, (db) => db.prepare("PRAGMA user_version").get())).toMatchObject({
    user_version: 3,
  });
  expect(
    edit(path, (db) =>
      db.prepare("SELECT name FROM sqlite_schema WHERE name = 'quality_reports'").get(),
    ),
  ).toBeUndefined();
  (await SQLiteEventStore.open({ path, projectId })).close();
});

it("does not overwrite conflicting tables or leave a partial layout", async () => {
  const path = await pathForStore();
  (await SQLiteEventStore.open({ path, projectId })).close();
  edit(path, (db) =>
    db.exec(
      "CREATE TABLE quality_report_chunks(owner_value TEXT); INSERT INTO quality_report_chunks VALUES ('owner');",
    ),
  );
  await expect(
    SQLiteEventStore.open({
      path,
      projectId,
      writableEventSchemaVersion: 6,
      reportStorage: "sqlite_v1",
    }),
  ).rejects.toThrow();
  expect(edit(path, (db) => db.prepare("PRAGMA user_version").get())).toMatchObject({
    user_version: 3,
  });
  expect(
    edit(path, (db) =>
      db.prepare("SELECT name FROM sqlite_schema WHERE name = 'quality_reports'").get(),
    ),
  ).toBeUndefined();
  expect(
    edit(path, (db) => db.prepare("SELECT owner_value FROM quality_report_chunks").get()),
  ).toMatchObject({ owner_value: "owner" });
});

it("rejects an incomplete format-4 layout on all reader paths", async () => {
  const path = await pathForStore();
  (
    await SQLiteEventStore.open({
      path,
      projectId,
      writableEventSchemaVersion: 6,
      reportStorage: "sqlite_v1",
    })
  ).close();
  edit(path, (db) => db.exec("DROP TABLE quality_report_chunks"));
  for (const open of [SQLiteEventStore.open, SQLiteEventStore.openReadOnly]) {
    await expect(open({ path, projectId })).rejects.toMatchObject({ code: "integrity_failed" });
  }
});

it.skipIf(process.platform === "win32")(
  "secures report files and rejects unsafe read-only permissions",
  async () => {
    const path = await pathForStore();
    (await SQLiteEventStore.open({ path, projectId })).close();
    await chmod(path, 0o644);
    const owner = await SQLiteEventStore.open({
      path,
      projectId,
      writableEventSchemaVersion: 6,
      reportStorage: "sqlite_v1",
    });
    for (const suffix of ["", "-wal", "-shm"])
      expect((await lstat(path + suffix)).mode & 0o077).toBe(0);
    owner.close();
    await chmod(path, 0o644);
    await expect(SQLiteEventStore.openReadOnly({ path, projectId })).rejects.toMatchObject({
      code: "integrity_failed",
    });
  },
);

it("rejects a retained reader after another owner changes its storage format", async () => {
  const path = await pathForStore();
  const owner = await SQLiteEventStore.open({ path, projectId });
  const reader = await SQLiteEventStore.openReadOnly({ path, projectId });
  try {
    (
      await SQLiteEventStore.open({
        path,
        projectId,
        writableEventSchemaVersion: 6,
        reportStorage: "sqlite_v1",
      })
    ).close();
    for (const store of [owner, reader])
      expect(() => store.reports.getReport("sha256:" + "0".repeat(64))).toThrowError(
        expect.objectContaining({ code: "integrity_failed" }),
      );
  } finally {
    reader.close();
    owner.close();
  }
});
