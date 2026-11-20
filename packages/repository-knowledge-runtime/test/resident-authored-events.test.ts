import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, expect, it, vi } from "vitest";

import { observeConvergenceQueue, residentWakeKey } from "../src/convergence-queue-observation.js";
import {
  foreignEventsHead,
  RESIDENT_AUTHORED_EVENT_TYPES,
} from "../src/resident-authored-events.js";
import {
  RESIDENT_EVENT_POLL_MILLISECONDS,
  watchResidentEventChanges,
} from "../src/resident-event-wakeup.js";

const roots: string[] = [];
afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

/** An event log that answers the typed head read like the SQLite store. */
function log() {
  const events: { type: string; eventHash: string }[] = [];
  let outstanding = 0;
  return {
    enqueue() {
      outstanding += 1;
    },
    append(type: string) {
      events.push({ type, eventHash: `sha256:${String(events.length + 1).padStart(64, "0")}` });
    },
    latest: () => (events.at(-1) ?? null) as never,
    latestHash: () => events.at(-1)?.eventHash ?? null,
    latestHashExcluding: (types: readonly string[]) =>
      events.findLast((event) => !types.includes(event.type))?.eventHash ?? null,
    outstandingCount: () => outstanding,
    listOutbox: () => [],
  };
}

it("names the resident's own outcome records and nothing that carries an obligation (ADR-0598)", () => {
  expect([...RESIDENT_AUTHORED_EVENT_TYPES].sort()).toEqual([
    "document.freshness.cycle.completed",
    "knowledge.instruction_capture.cycle.completed",
    "repository.knowledge.stage.recorded",
  ]);
  expect(RESIDENT_AUTHORED_EVENT_TYPES).not.toContain("repository.knowledge.convergence.recorded");
  expect(RESIDENT_AUTHORED_EVENT_TYPES).not.toContain("knowledge.convergence.owner.changed");
});

it("keeps the fence head on foreign events, so a resident's own records never change it", () => {
  const events = log();
  events.append("run.requested");
  const head = observeConvergenceQueue(events as never).eventsHead;
  expect(head).toBe(events.latestHash());
  // A repeated stage record with no new work, then a freshness summary.
  for (const type of RESIDENT_AUTHORED_EVENT_TYPES) events.append(type);
  events.append("repository.knowledge.stage.recorded");
  expect(observeConvergenceQueue(events as never).eventsHead).toBe(head);
  events.append("knowledge.instruction_candidate.exchanged");
  expect(observeConvergenceQueue(events as never).eventsHead).not.toBe(head);
});

it("wakes on the event head alone when the outbox cannot be read", () => {
  const events = log();
  events.append("run.requested");
  const { outstandingCount: _count, ...broken } = events;
  expect(residentWakeKey(broken as never)).toBe(events.latestHash());
});

it("falls back to the unfiltered head for a store without the typed read", () => {
  const events = log();
  events.append("document.freshness.cycle.completed");
  const { latestHashExcluding: _typed, ...plain } = events;
  // Without the typed read a resident may wake more often, never less.
  expect(foreignEventsHead(plain)).toBe(events.latestHash());
  const { latestHash: _hash, ...oldest } = plain;
  expect(foreignEventsHead({ ...oldest, latest: () => ({ eventHash: "sha256:x" }) as never })).toBe(
    "sha256:x",
  );
  expect(foreignEventsHead(events)).toBeNull();
});

it("wakes the resident for a foreign event or new work, never for its own outcome records", async () => {
  vi.useFakeTimers();
  const root = await mkdtemp(join(tmpdir(), "lervo-resident-authored-"));
  roots.push(root);
  const events = log();
  const notify = vi.fn();
  const stop = watchResidentEventChanges(
    { paths: { eventDatabase: join(root, "events.sqlite") }, events } as never,
    notify,
  );
  try {
    events.append("document.freshness.cycle.completed");
    events.append("repository.knowledge.stage.recorded");
    events.append("knowledge.instruction_capture.cycle.completed");
    await vi.advanceTimersByTimeAsync(RESIDENT_EVENT_POLL_MILLISECONDS);
    expect(notify).not.toHaveBeenCalled();
    events.append("knowledge.instruction_candidate.exchanged");
    await vi.advanceTimersByTimeAsync(RESIDENT_EVENT_POLL_MILLISECONDS);
    expect(notify).toHaveBeenCalledTimes(1);
    // A stage another command recorded with its successor job still wakes the resident.
    events.append("repository.knowledge.stage.recorded");
    events.enqueue();
    await vi.advanceTimersByTimeAsync(RESIDENT_EVENT_POLL_MILLISECONDS);
    expect(notify).toHaveBeenCalledTimes(2);
  } finally {
    stop();
  }
});

it("reads one aggregate per destination and lists no delivery when the store has it (ADR-0601)", () => {
  const events = log();
  events.append("run.requested");
  const listOutbox = vi.fn(() => []);
  const outboxSummary = vi.fn((destinationId: string) =>
    destinationId === "knowledge:convergence"
      ? {
          outstanding: 2,
          earliestAvailableAt: "2026-11-20T01:00:00.000Z",
          earliestLeaseExpiresAt: "2026-11-20T00:30:00.000Z",
        }
      : { outstanding: 0, earliestAvailableAt: null, earliestLeaseExpiresAt: null },
  );
  const queue = observeConvergenceQueue({ ...events, listOutbox, outboxSummary } as never);
  expect(listOutbox).not.toHaveBeenCalled();
  expect(outboxSummary).toHaveBeenCalledTimes(3);
  expect(queue.outboxOutstanding["knowledge:convergence"]).toBe(2);
  // The earliest due moment is the lease expiry, as the listing would report it.
  expect(queue.earliestAvailableAt).toBe(Date.parse("2026-11-20T00:30:00.000Z"));
});

it("leaves the owner-drained backlog out of a non-owner's wake key (ADR-0601)", () => {
  const events = log();
  events.append("run.requested");
  const owner = residentWakeKey(events as never);
  const waiting = residentWakeKey(events as never, false);
  events.enqueue();
  // Work only the owner drains changes the owner's key and never a non-owner's.
  expect(residentWakeKey(events as never)).not.toBe(owner);
  expect(residentWakeKey(events as never, false)).toBe(waiting);
  expect(observeConvergenceQueue(events as never, { owner: false })).toEqual({
    eventsHead: events.latestHash(),
    outboxOutstanding: {},
    earliestAvailableAt: null,
  });
  // A foreign event still wakes a non-owner.
  events.append("knowledge.instruction_candidate.exchanged");
  expect(residentWakeKey(events as never, false)).not.toBe(waiting);
});

it("keeps a non-owner watch asleep through its backlog and wakes it for a foreign event", async () => {
  vi.useFakeTimers();
  const root = await mkdtemp(join(tmpdir(), "lervo-resident-non-owner-"));
  roots.push(root);
  const events = log();
  const notify = vi.fn();
  const stop = watchResidentEventChanges(
    { paths: { eventDatabase: join(root, "events.sqlite") }, events } as never,
    notify,
    () => false,
  );
  try {
    events.enqueue();
    events.enqueue();
    await vi.advanceTimersByTimeAsync(RESIDENT_EVENT_POLL_MILLISECONDS);
    expect(notify).not.toHaveBeenCalled();
    events.append("knowledge.instruction_candidate.exchanged");
    await vi.advanceTimersByTimeAsync(RESIDENT_EVENT_POLL_MILLISECONDS);
    expect(notify).toHaveBeenCalledTimes(1);
  } finally {
    stop();
  }
});
