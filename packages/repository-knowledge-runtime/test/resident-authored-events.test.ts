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
