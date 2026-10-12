import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import type { EventDraftV1 } from "@lervo/event-contract";
import type { ReportTransaction } from "@lervo/storage-contract";
import { afterEach, expect, it, vi } from "vitest";
import { SQLiteEventStore } from "../src/index.js";
import { sqliteRow } from "../src/sqlite-row.js";
import { SQLiteReportRepository } from "../src/report-repository.js";

const roots: string[] = [];
const stores: SQLiteEventStore[] = [];
const projectId = "prj_report_writer";
const bytes = Buffer.from("private report for atomic publication");
const hash = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
afterEach(async () => {
  vi.restoreAllMocks();
  for (const store of stores.splice(0)) store.close();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
function draft(eventId = "evt_report_writer"): EventDraftV1 {
  return {
    eventId,
    projectId,
    runId: "run_report_writer",
    sessionId: "ses_report_writer",
    type: "run.requested",
    occurredAt: "2026-10-11T00:00:00Z",
    actor: { kind: "system" },
    schemaVersion: 1,
    policyVersion: hash,
    payload: { requestDigest: hash, role: "developer" },
  };
}
async function open() {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-report-writer-"));
  roots.push(root);
  const store = await SQLiteEventStore.open({
    path: resolve(root, "events.sqlite"),
    projectId,
    writableEventSchemaVersion: 6,
    reportStorage: "sqlite_v1",
  });
  stores.push(store);
  return store;
}
function edit<T>(path: string, work: (database: DatabaseSync) => T): T {
  const db = new DatabaseSync(path);
  try {
    return work(db);
  } finally {
    db.close();
  }
}
function publish(store: SQLiteEventStore) {
  return store.reportWriter!.transact((tx) => ({
    artifact: tx.putReport(bytes),
    event: tx.append(draft()),
  }));
}

it("requires explicit selection for each writable opening and never grants a read-only writer", async () => {
  const store = await open();
  expect(store.reportWriter).toBeDefined();
  for (const options of [{}, { writableEventSchemaVersion: 6 as const }]) {
    const other = await SQLiteEventStore.open({ path: store.path, projectId, ...options });
    stores.push(other);
    expect(other.reportWriter).toBeUndefined();
  }
  const reader = await SQLiteEventStore.openReadOnly({ path: store.path, projectId });
  stores.push(reader);
  expect(reader.reportWriter).toBeUndefined();
  store.close();
  expect(() => publish(store)).toThrowError(expect.objectContaining({ code: "closed" }));
});

it("commits reports and events together and independently rereads every accepted body", async () => {
  const store = await open();
  const visibleEventCounts: number[] = [];
  const get = SQLiteReportRepository.prototype.get;
  vi.spyOn(SQLiteReportRepository.prototype, "get").mockImplementation(function (
    this: SQLiteReportRepository,
    hash,
  ) {
    const body = get.call(this, hash);
    if (body)
      visibleEventCounts.push(
        edit(store.path, (db) =>
          Number(sqliteRow(db.prepare("SELECT count(*) AS n FROM events").get())?.n),
        ),
      );
    return body;
  });
  expect(publish(store)).toMatchObject({ artifact: { created: true }, event: { inserted: true } });
  expect(visibleEventCounts).toEqual([0, 1]);
  visibleEventCounts.length = 0;
  expect(publish(store)).toMatchObject({
    artifact: { created: false },
    event: { inserted: false },
  });
  expect(visibleEventCounts).toEqual([1, 1]);
  vi.restoreAllMocks();
  store.close();
  const reader = await SQLiteEventStore.openReadOnly({ path: store.path, projectId });
  stores.push(reader);
  expect(reader.reports.getReport(hash)).toEqual(bytes);
  expect(reader.list()).toHaveLength(1);
});

it("uses FULL synchronization and both fullfsync settings at the report commit", async () => {
  const store = await open();
  const exec = DatabaseSync.prototype.exec;
  const commits: unknown[] = [];
  vi.spyOn(DatabaseSync.prototype, "exec").mockImplementation(function (this: DatabaseSync, sql) {
    if (sql === "COMMIT;")
      commits.push([
        this.prepare("PRAGMA synchronous").get(),
        this.prepare("PRAGMA fullfsync").get(),
        this.prepare("PRAGMA checkpoint_fullfsync").get(),
      ]);
    return exec.call(this, sql);
  });
  publish(store);
  expect(commits).toEqual([[{ synchronous: 2 }, { fullfsync: 1 }, { checkpoint_fullfsync: 1 }]]);
});

it("rolls back both records after an owner failure and permits a later retry", async () => {
  const store = await open();
  expect(() =>
    store.reportWriter!.transact((tx) => {
      tx.putReport(bytes);
      tx.append(draft());
      throw new Error("owner failure");
    }),
  ).toThrow("owner failure");
  expect(store.reports.getReport(hash)).toBeNull();
  expect(store.list()).toHaveLength(0);
  expect(publish(store).event.inserted).toBe(true);
});

it("poisons a batch after a caught partial report insertion failure", async () => {
  const store = await open();
  edit(store.path, (db) =>
    db.exec(`CREATE TRIGGER reject_chunk BEFORE INSERT ON quality_report_chunks
    BEGIN SELECT RAISE(ABORT, 'injected chunk failure'); END;`),
  );
  expect(() =>
    store.reportWriter!.transact((tx) => {
      try {
        tx.putReport(bytes);
      } catch {
        /* A caller cannot convert this failure into success. */
      }
      tx.append(draft());
    }),
  ).toThrow("injected chunk failure");
  expect(store.reports.getReport(hash)).toBeNull();
  expect(store.list()).toHaveLength(0);
  edit(store.path, (db) => db.exec("DROP TRIGGER reject_chunk"));
  expect(publish(store).event.inserted).toBe(true);
});

it("rolls back a caught event conflict and a newly inserted report", async () => {
  const store = await open();
  store.append(draft());
  expect(() =>
    store.reportWriter!.transact((tx) => {
      tx.putReport(bytes);
      try {
        tx.append({ ...draft(), occurredAt: "2026-10-12T00:00:00Z" });
      } catch {
        /* Poisoned. */
      }
    }),
  ).toThrowError(expect.objectContaining({ code: "event_id_conflict" }));
  expect(store.reports.getReport(hash)).toBeNull();
  expect(store.list()).toHaveLength(1);
});

it("rejects asynchronous callbacks and escaped transaction methods without later writes", async () => {
  const store = await open();
  let escaped!: ReportTransaction;
  expect(() =>
    store.reportWriter!.transact(async (tx) => {
      escaped = tx;
      tx.putReport(bytes);
      await Promise.resolve();
      tx.append(draft());
    }),
  ).toThrowError(expect.objectContaining({ code: "transaction_async" }));
  await Promise.resolve();
  expect(() => escaped.putReport(bytes)).toThrowError(
    expect.objectContaining({ code: "invalid_report" }),
  );
  expect(() => escaped.append(draft())).toThrowError(
    expect.objectContaining({ code: "invalid_report" }),
  );
  expect(store.reports.getReport(hash)).toBeNull();
  expect(store.list()).toHaveLength(0);
});

it("mutually excludes ordinary and report transactions", async () => {
  const store = await open();
  expect(() => store.transact(() => publish(store))).toThrowError(
    expect.objectContaining({ code: "nested_transaction" }),
  );
  expect(() =>
    store.reportWriter!.transact((tx) => {
      tx.putReport(bytes);
      store.append(draft());
    }),
  ).toThrowError(expect.objectContaining({ code: "nested_transaction" }));
  expect(store.reports.getReport(hash)).toBeNull();
  expect(store.list()).toHaveLength(0);
});

it("rejects the seventeenth report and rolls back the entire fixed batch", async () => {
  const store = await open();
  expect(() =>
    store.reportWriter!.transact((tx) => {
      tx.append(draft());
      for (let index = 0; index < 17; index++) tx.putReport(bytes);
    }),
  ).toThrowError(expect.objectContaining({ code: "report_capacity_exceeded" }));
  expect(store.reports.getReport(hash)).toBeNull();
  expect(store.list()).toHaveLength(0);
});

it("fails without a receipt after a post-commit read error and allows an exact retry", async () => {
  const store = await open();
  const get = SQLiteReportRepository.prototype.get;
  let reads = 0;
  vi.spyOn(SQLiteReportRepository.prototype, "get").mockImplementation(function (
    this: SQLiteReportRepository,
    hash,
  ) {
    const body = get.call(this, hash);
    if (body && ++reads === 2) throw new Error("injected post-commit read failure");
    return body;
  });
  expect(() => publish(store)).toThrow("injected post-commit read failure");
  vi.restoreAllMocks();
  expect(store.reports.getReport(hash)).toEqual(bytes);
  expect(store.list()).toHaveLength(1);
  expect(publish(store)).toMatchObject({
    artifact: { created: false },
    event: { inserted: false },
  });
});

it("checks current metadata integrity before inserting a report", async () => {
  const store = await open();
  edit(store.path, (db) =>
    db.exec("UPDATE store_meta SET value = 'prj_rebound' WHERE key = 'project_id'"),
  );
  expect(() => publish(store)).toThrowError(expect.objectContaining({ code: "integrity_failed" }));
  expect(store.reports.getReport(hash)).toBeNull();
  expect(store.list()).toHaveLength(0);
});

it("rolls back a failed commit and never returns its callback result", async () => {
  const store = await open();
  const exec = DatabaseSync.prototype.exec;
  let injected = false;
  vi.spyOn(DatabaseSync.prototype, "exec").mockImplementation(function (this: DatabaseSync, sql) {
    if (sql === "COMMIT;" && !injected) {
      injected = true;
      throw new Error("injected commit failure");
    }
    return exec.call(this, sql);
  });
  expect(() => publish(store)).toThrow("injected commit failure");
  expect(store.reports.getReport(hash)).toBeNull();
  expect(store.list()).toHaveLength(0);
  expect(publish(store).event.inserted).toBe(true);
});

it("rejects a corrupt existing body before publishing any event", async () => {
  const store = await open();
  store.reportWriter!.transact((tx) => tx.putReport(bytes));
  edit(store.path, (db) => db.exec("UPDATE quality_report_chunks SET body = x'00' WHERE part = 0"));
  expect(() => publish(store)).toThrowError(expect.objectContaining({ code: "report_corrupt" }));
  expect(store.list()).toHaveLength(0);
});

it("selects an existing report format without migrating a legacy store", async () => {
  const migrated = await open();
  const selected = await SQLiteEventStore.open({
    path: migrated.path,
    projectId,
    writableEventSchemaVersion: 6,
    reportStorage: "existing_sqlite_v1",
  });
  stores.push(selected);
  expect(selected.reportWriter).toBeDefined();
  expect(publish(selected).event.inserted).toBe(true);
  const legacy = await SQLiteEventStore.open({
    path: resolve(roots.at(-1)!, "legacy.sqlite"),
    projectId,
    writableEventSchemaVersion: 6,
    reportStorage: "existing_sqlite_v1",
  });
  stores.push(legacy);
  expect(legacy.reportWriter).toBeUndefined();
  expect(edit(legacy.path, (db) => db.prepare("PRAGMA user_version").get())).toMatchObject({
    user_version: 3,
  });
});
