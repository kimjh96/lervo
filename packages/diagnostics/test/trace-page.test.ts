import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { SQLiteEventStore } from "@lervo/event-store-sqlite";
import { createTracePage, readTracePageReport } from "@lervo/diagnostics";
import { afterEach, describe, expect, it } from "vitest";

const roots: string[] = [];
const projectId = "prj_01234567";

async function storeWithEvents(count: number): Promise<SQLiteEventStore> {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-trace-page-"));
  roots.push(root);
  const store = await SQLiteEventStore.open({
    path: resolve(root, "events.sqlite"),
    projectId,
  });
  for (let index = 1; index <= count; index += 1) {
    store.append({
      eventId: `evt_trace_page_${String(index).padStart(8, "0")}`,
      projectId,
      runId: "run_trace_page_01",
      sessionId: "ses_trace_page_01",
      type: index % 2 === 0 ? "run.failed" : "run.requested",
      occurredAt: `2026-08-20T00:00:0${index}Z`,
      actor: { kind: "system" },
      schemaVersion: 1,
      policyVersion: `sha256:${"a".repeat(64)}`,
      payload:
        index % 2 === 0
          ? {
              failureCode: "fixture_failure",
              retryable: false,
              diagnosticDigest: `sha256:${"c".repeat(64)}`,
            }
          : {
              requestDigest: `sha256:${"b".repeat(64)}`,
              role: "developer",
              risk: "low",
            },
    });
  }
  return store;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("snapshot-bound local trace pages", () => {
  it("reads each event once with a cursor bound to one snapshot", async () => {
    const store = await storeWithEvents(3);
    const first = createTracePage({ projectId, events: store, selector: "last", limit: 2 });
    expect(first.events.map((event) => event.seq)).toEqual([1, 2]);
    expect(first.page.hasMore).toBe(true);

    const second = createTracePage({
      projectId,
      events: store,
      cursor: first.page.nextCursor!,
    });
    expect(second.events.map((event) => event.seq)).toEqual([3]);
    expect(second.page).toMatchObject({ afterSeq: 2, returnedCount: 1, hasMore: false });
    store.close();
  });

  it("rejects a tampered cursor and a cursor made stale by an append", async () => {
    const store = await storeWithEvents(3);
    const first = createTracePage({ projectId, events: store, selector: "last", limit: 1 });
    const cursor = first.page.nextCursor!;
    expect(() =>
      createTracePage({
        projectId,
        events: store,
        cursor: `${cursor.slice(0, -1)}${cursor.endsWith("0") ? "1" : "0"}`,
      }),
    ).toThrowError(expect.objectContaining({ code: "trace_cursor_invalid" }));

    store.append({
      eventId: "evt_trace_page_append",
      projectId,
      runId: "run_trace_page_01",
      sessionId: "ses_trace_page_01",
      type: "run.requested",
      occurredAt: "2026-08-20T00:00:04Z",
      actor: { kind: "system" },
      schemaVersion: 1,
      policyVersion: `sha256:${"a".repeat(64)}`,
      payload: { requestDigest: `sha256:${"b".repeat(64)}`, role: "developer", risk: "low" },
    });
    expect(() => createTracePage({ projectId, events: store, cursor })).toThrowError(
      expect.objectContaining({ code: "trace_cursor_stale" }),
    );
    store.close();
  });

  it("rejects incompatible page versions and contradictory cursor metadata", async () => {
    const store = await storeWithEvents(2);
    const page = createTracePage({ projectId, events: store, selector: "last", limit: 1 });
    expect(() => readTracePageReport({ ...page, schemaVersion: 2 })).toThrowError(
      expect.objectContaining({ code: "trace_page_report_schema_unsupported" }),
    );
    expect(() =>
      readTracePageReport({
        ...page,
        page: { ...page.page, returnedCount: 2 },
      }),
    ).toThrowError(expect.objectContaining({ code: "trace_page_report_invalid" }));
    store.close();
  });

  it("binds an event type filter into every cursor page", async () => {
    const store = await storeWithEvents(5);
    const first = createTracePage({
      projectId,
      events: store,
      selector: "last",
      limit: 1,
      eventTypes: ["run.failed"],
    });
    expect(first.events.map((event) => event.seq)).toEqual([2]);
    expect(first.filter).toEqual({ eventTypes: ["run.failed"] });

    const second = createTracePage({ projectId, events: store, cursor: first.page.nextCursor! });
    expect(second.events.map((event) => event.seq)).toEqual([4]);
    expect(second.filter).toEqual(first.filter);
    expect(second.page.hasMore).toBe(false);
    store.close();
  });

  it("distinguishes no filter matches from a missing run", async () => {
    const store = await storeWithEvents(3);
    expect(() =>
      createTracePage({
        projectId,
        events: store,
        selector: "last",
        eventTypes: ["run.completed"],
      }),
    ).toThrowError(expect.objectContaining({ code: "trace_filter_empty" }));
    store.close();
  });
});
