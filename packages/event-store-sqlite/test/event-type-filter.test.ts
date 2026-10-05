import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { afterEach, describe, expect, it } from "vitest";

import type { EventEnvelope } from "@lervo/schemas";

import { type EventDraft, SQLiteEventStore } from "../src/index.js";
import { sqliteRow, sqliteRows } from "../src/sqlite-row.js";

const projectId = "prj_01234567";
const policyVersion = "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const temporaryRoots: string[] = [];

async function databasePath(): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-event-types-"));
  temporaryRoots.push(root);
  return resolve(root, "state/events.sqlite");
}

function requested(index: number, runId = `run_${String(index).padStart(8, "0")}`): EventDraft {
  return {
    eventId: `evt_req_${String(index).padStart(8, "0")}`,
    projectId,
    runId,
    sessionId: "ses_01234567",
    type: "run.requested",
    occurredAt: "2026-10-05T00:00:00Z",
    actor: { kind: "user" },
    schemaVersion: 1,
    policyVersion,
    payload: {
      requestDigest: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      role: "developer",
    },
  };
}

function causal(index: number, runId = `run_${String(index).padStart(8, "0")}`): EventDraft {
  return {
    eventId: `evt_cau_${String(index).padStart(8, "0")}`,
    projectId,
    runId,
    sessionId: "ses_01234567",
    type: "work.causality.recorded",
    occurredAt: "2026-10-05T00:00:00.000Z",
    actor: { kind: "system" },
    schemaVersion: 2,
    policyVersion,
    payload: {
      workId: `wrk_${String(index).padStart(24, "0")}`,
      executionContractVersion: 1,
      relationship: "root",
      parentRunId: null,
      retryOfRunId: null,
      attemptOrdinal: 1,
      workstreamId: null,
      assignmentId: null,
      agentId: null,
    },
  };
}

/** Reference semantics: a type-filtered page equals the unfiltered walk filtered in memory. */
function filteredWalk(
  store: SQLiteEventStore,
  types: readonly string[],
  options: { afterSeq?: number; runId?: string } = {},
): EventEnvelope[] {
  const all: EventEnvelope[] = [];
  let afterSeq = options.afterSeq ?? 0;
  while (true) {
    const page = store.list({
      afterSeq,
      limit: 1000,
      ...(options.runId === undefined ? {} : { runId: options.runId }),
    });
    all.push(...page);
    if (page.length < 1000) break;
    afterSeq = page.at(-1)!.seq;
  }
  return all.filter((event) => types.includes(event.type));
}

function pagedTypes(
  store: SQLiteEventStore,
  types: readonly string[],
  limit: number,
  options: { afterSeq?: number; runId?: string } = {},
): EventEnvelope[] {
  const all: EventEnvelope[] = [];
  let afterSeq = options.afterSeq ?? 0;
  while (true) {
    const page = store.list({
      afterSeq,
      limit,
      types,
      ...(options.runId === undefined ? {} : { runId: options.runId }),
    });
    all.push(...page);
    if (page.length < limit) break;
    afterSeq = page.at(-1)!.seq;
  }
  return all;
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("SQLite type-filtered event pages", () => {
  it("returns exactly the in-memory filtered walk in sequence order for every page size", async () => {
    const store = await SQLiteEventStore.open({
      path: await databasePath(),
      projectId,
      writableEventSchemaVersion: 2,
    });
    for (let index = 1; index <= 60; index += 1)
      store.append(index % 3 === 0 ? causal(index) : requested(index));

    for (const types of [
      ["work.causality.recorded"],
      ["run.requested"],
      ["run.requested", "work.causality.recorded"],
      ["work.causality.recorded", "work.causality.recorded"],
      ["absent.type"],
    ]) {
      for (const limit of [1, 7, 1000]) {
        expect(pagedTypes(store, types, limit)).toEqual(filteredWalk(store, types));
        expect(pagedTypes(store, types, limit, { afterSeq: 31 })).toEqual(
          filteredWalk(store, types, { afterSeq: 31 }),
        );
      }
    }
    const typed = store.list({ types: ["work.causality.recorded"], limit: 1000 });
    expect(typed.map((event) => event.seq)).toEqual(
      [...typed.map((event) => event.seq)].sort((left, right) => left - right),
    );
    store.close();
  });

  it("combines the type filter with the run filter", async () => {
    const store = await SQLiteEventStore.open({
      path: await databasePath(),
      projectId,
      writableEventSchemaVersion: 2,
    });
    for (let index = 1; index <= 12; index += 1) {
      const runId = index % 2 === 0 ? "run_shared01" : `run_${String(index).padStart(8, "0")}`;
      store.append(
        index % 4 === 0
          ? causal(index, `run_cau${String(index).padStart(5, "0")}`)
          : requested(index, runId),
      );
    }
    expect(pagedTypes(store, ["run.requested"], 2, { runId: "run_shared01" })).toEqual(
      filteredWalk(store, ["run.requested"], { runId: "run_shared01" }),
    );
    store.close();
  });

  it("omitting types keeps every event, and invalid type lists are rejected", async () => {
    const store = await SQLiteEventStore.open({
      path: await databasePath(),
      projectId,
      writableEventSchemaVersion: 2,
    });
    store.append(requested(1));
    store.append(causal(2));
    expect(store.list().map((event) => event.type)).toEqual([
      "run.requested",
      "work.causality.recorded",
    ]);
    expect(() => store.list({ types: [] })).toThrow(RangeError);
    expect(() => store.list({ types: [""] })).toThrow(RangeError);
    expect(() =>
      store.list({ types: Array.from({ length: 65 }, (_, index) => `type.${index}`) }),
    ).toThrow(RangeError);
    store.close();
  });

  it("adds the type index idempotently to an existing store without changing its schema version", async () => {
    const path = await databasePath();
    const first = await SQLiteEventStore.open({ path, projectId });
    const event = first.append(requested(1)).event;
    first.close();

    // An existing store written before the index existed.
    const legacy = new DatabaseSync(path);
    legacy.exec("DROP INDEX events_type_seq;");
    const versionBefore = sqliteRow(legacy.prepare("PRAGMA user_version;").get())?.user_version;
    legacy.close();

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const reopened = await SQLiteEventStore.open({ path, projectId });
      expect(reopened.list({ types: ["run.requested"] })).toEqual([event]);
      reopened.close();
    }
    const raw = new DatabaseSync(path);
    expect(sqliteRow(raw.prepare("PRAGMA user_version;").get())?.user_version).toBe(versionBefore);
    expect(
      sqliteRow(
        raw
          .prepare("SELECT count(*) AS count FROM sqlite_master WHERE type = 'index' AND name = ?")
          .get("events_type_seq"),
      )?.count,
    ).toBe(1);
    const plan = sqliteRows(
      raw
        .prepare(
          "EXPLAIN QUERY PLAN SELECT * FROM events WHERE project_id = ? AND type IN (?) AND seq > ? ORDER BY seq LIMIT ?",
        )
        .all(projectId, "run.requested", 0, 1000),
    ).map((row) => String(row.detail));
    expect(plan.some((detail) => detail.includes("events_type_seq"))).toBe(true);
    raw.close();

    const readOnly = await SQLiteEventStore.openReadOnly({ path, projectId });
    expect(readOnly.list({ types: ["run.requested"] })).toEqual([event]);
    readOnly.close();
  });

  it("keeps type-filtered reads correct on a read-only store that lacks the index", async () => {
    const path = await databasePath();
    const writer = await SQLiteEventStore.open({ path, projectId });
    const event = writer.append(requested(1)).event;
    writer.close();
    const legacy = new DatabaseSync(path);
    legacy.exec("DROP INDEX events_type_seq;");
    legacy.close();

    const readOnly = await SQLiteEventStore.openReadOnly({ path, projectId });
    expect(readOnly.list({ types: ["run.requested"] })).toEqual([event]);
    readOnly.close();
  });
});
