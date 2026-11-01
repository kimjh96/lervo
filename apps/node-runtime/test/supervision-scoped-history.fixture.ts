import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { computeEventHash, eventWithoutHash } from "@lervo/event-contract";
import type { EventStore } from "@lervo/storage-contract";
import { event, projectId, workstreamId } from "../../../packages/work-controller/test/fixtures.js";
import { ScopedSupervisionExecutionHistory } from "../src/supervision-scoped-history.js";

export async function scopedHistoryFixture(roots: string[]) {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-scoped-supervision-"));
  roots.push(root);
  const databasePath = resolve(root, "events.sqlite");
  await writeFile(databasePath, "owned event-store test port");
  const rows: ReturnType<typeof event>[] = [];
  let at = Date.now();
  const append = (
    type: string,
    runId: string,
    payload: Record<string, unknown> = {},
    provider?: "codex" | "claude",
  ) => {
    const input = event(rows.length + 1, type, runId, payload, provider);
    const body = {
      ...eventWithoutHash(input),
      occurredAt: "2026-09-28T00:00:00.000Z",
      previousHash: rows.at(-1)?.eventHash ?? null,
    };
    const value = { ...body, eventHash: computeEventHash(body) };
    rows.push(value);
    return value;
  };
  // Like the SQLite store, this port returns only events whose content matches their hash.
  const verified = <T extends ReturnType<typeof event> | null>(row: T): T => {
    if (row !== null && computeEventHash(eventWithoutHash(row)) !== row.eventHash)
      throw new Error(`The event hash does not match at ${row.eventId}.`);
    return structuredClone(row);
  };
  const events: EventStore = {
    append() {
      throw new Error("Read-only projection must not append events");
    },
    transact() {
      throw new Error("Read-only projection must not write a transaction");
    },
    get: (id) => verified(rows.find((row) => row.eventId === id) ?? null),
    latest: () => verified(rows.at(-1) ?? null),
    list: (options) =>
      rows
        .slice(options?.afterSeq ?? 0)
        .filter((row) => options?.runId === undefined || row.runId === options.runId)
        .filter((row) => options?.types === undefined || options.types.includes(row.type))
        .slice(0, options?.limit)
        .map(verified),
    verifyIntegrity: () => ({
      valid: true,
      eventCount: rows.length,
      headHash: rows.at(-1)?.eventHash ?? null,
    }),
    close() {},
  };
  const reader = new ScopedSupervisionExecutionHistory({
    events,
    databasePath,
    projectId,
    workstreamId,
    now: () => at,
  });
  return {
    root,
    databasePath,
    rows,
    events,
    append,
    reader,
    advance: (ms: number) => {
      at += ms;
    },
  };
}
