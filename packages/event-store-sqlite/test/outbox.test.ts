import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { afterEach, describe, expect, it } from "vitest";

import { type EventDraftV1, SQLiteEventStore } from "../src/index.js";
import { sqliteRow } from "../src/sqlite-row.js";

const projectId = "prj_01234567";
const destinationId = "hub:primary";
const policyVersion = "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const temporaryRoots: string[] = [];

async function databasePath(): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-outbox-"));
  temporaryRoots.push(root);
  return resolve(root, "state/events.sqlite");
}

function draft(index = 1, overrides: Partial<EventDraftV1> = {}): EventDraftV1 {
  return {
    eventId: `evt_${String(index).padStart(8, "0")}`,
    projectId,
    runId: "run_01234567",
    sessionId: "ses_01234567",
    type: "run.completed",
    occurredAt: `2026-08-18T00:00:${String(index).padStart(2, "0")}Z`,
    actor: { kind: "system" },
    schemaVersion: 1,
    policyVersion,
    payload: {
      resultDigest: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      artifactIds: ["art_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"],
      verificationStatus: "not_run",
    },
    ...overrides,
  };
}

function enqueueRequest(eventId: string, index = 1) {
  return {
    eventId,
    destinationId,
    enqueuedAt: `2026-08-18T00:01:${String(index).padStart(2, "0")}Z`,
  };
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("SQLite transactional outbox", () => {
  it("bounds one destination's recent acknowledgements while preserving live work and canonical history", async () => {
    const store = await SQLiteEventStore.open({ path: await databasePath(), projectId });
    try {
      for (let index = 1; index <= 4; index++) {
        const event = store.append(draft(index)).event;
        store.enqueue(enqueueRequest(event.eventId, index));
        store.enqueue({
          ...enqueueRequest(event.eventId, index),
          destinationId: "knowledge:convergence",
        });
      }
      for (const target of [destinationId, "knowledge:convergence"]) {
        const deliveries = store.claim({
          destinationId: target,
          workerId: "retention-worker",
          claimedAt: "2026-08-18T00:02:00Z",
          leaseDurationMs: 60_000,
          limit: 3,
        });
        for (const [index, delivery] of deliveries.entries())
          store.acknowledge({
            eventId: delivery.event.eventId,
            destinationId: target,
            workerId: "retention-worker",
            acknowledgedAt: `2026-08-18T00:02:0${index + 1}Z`,
          });
      }
      expect(
        store.purgeAcknowledged({
          before: "2026-08-17T00:00:00Z",
          destinationId: "knowledge:convergence",
          keepMostRecent: 1,
        }),
      ).toEqual({ deleted: 2 });
      expect(store.listOutbox({ destinationId, status: "acknowledged" })).toHaveLength(3);
      expect(
        store
          .listOutbox({ destinationId: "knowledge:convergence", status: "acknowledged" })
          .map((row) => row.event.eventId),
      ).toEqual([draft(3).eventId]);
      expect(store.listOutbox({ status: "pending" })).toHaveLength(2);
      expect(store.list()).toHaveLength(4);
      expect(() =>
        store.purgeAcknowledged({ before: "2026-08-17T00:00:00Z", keepMostRecent: 1 }),
      ).toThrowError(expect.objectContaining({ code: "invalid_outbox_request" }));
    } finally {
      store.close();
    }
  });

  it("commits an event and its destination in one transaction", async () => {
    const store = await SQLiteEventStore.open({ path: await databasePath(), projectId });

    const result = store.transact((transaction) => {
      const appended = transaction.append(draft());
      const enqueued = transaction.enqueue(enqueueRequest(appended.event.eventId));
      return { appended, enqueued };
    });

    expect(result.appended.inserted).toBe(true);
    expect(result.enqueued.inserted).toBe(true);
    expect(store.listOutbox()).toEqual([
      expect.objectContaining({
        event: result.appended.event,
        destinationId,
        status: "pending",
        attemptCount: 0,
      }),
    ]);
    store.close();
  });

  it("rolls back the event when enqueue validation fails", async () => {
    const store = await SQLiteEventStore.open({ path: await databasePath(), projectId });

    expect(() =>
      store.transact((transaction) => {
        const appended = transaction.append(draft());
        transaction.enqueue({
          ...enqueueRequest(appended.event.eventId),
          destinationId: "invalid destination",
        });
      }),
    ).toThrowError(expect.objectContaining({ code: "invalid_outbox_request" }));
    expect(store.list()).toEqual([]);
    expect(store.listOutbox()).toEqual([]);
    store.close();
  });

  it("keeps local-only events without creating an implicit outbox item", async () => {
    const store = await SQLiteEventStore.open({ path: await databasePath(), projectId });
    store.append(draft());
    expect(store.list()).toHaveLength(1);
    expect(store.listOutbox()).toEqual([]);
    store.close();
  });

  it("deduplicates the same event and destination while retaining the first schedule", async () => {
    const store = await SQLiteEventStore.open({ path: await databasePath(), projectId });
    const event = store.append(draft()).event;

    expect(store.enqueue(enqueueRequest(event.eventId)).inserted).toBe(true);
    expect(
      store.enqueue({
        ...enqueueRequest(event.eventId),
        enqueuedAt: "2026-08-18T00:09:00Z",
      }).inserted,
    ).toBe(false);
    expect(store.listOutbox()).toHaveLength(1);
    expect(store.listOutbox()[0]?.enqueuedAt).toBe("2026-08-18T00:01:01.000Z");
    store.close();
  });

  it("allows one event to target independent destinations", async () => {
    const store = await SQLiteEventStore.open({ path: await databasePath(), projectId });
    const event = store.append(draft()).event;
    store.enqueue(enqueueRequest(event.eventId));
    store.enqueue({
      ...enqueueRequest(event.eventId),
      destinationId: "hub:backup",
    });

    expect(store.listOutbox().map((item) => item.destinationId)).toEqual([
      "hub:backup",
      "hub:primary",
    ]);
    store.close();
  });

  it("reads one exact destination through pending, leased, and acknowledged states", async () => {
    const path = await databasePath();
    const store = await SQLiteEventStore.open({ path, projectId });
    const event = store.append(draft()).event;
    expect(store.getOutbox(event.eventId, destinationId)).toBeNull();
    store.enqueue(enqueueRequest(event.eventId));
    store.enqueue({ ...enqueueRequest(event.eventId), destinationId: "hub:backup" });
    expect(store.getOutbox(event.eventId, destinationId)).toMatchObject({
      event: { eventId: event.eventId, eventHash: event.eventHash },
      destinationId,
      status: "pending",
      attemptCount: 0,
    });
    const claimed = store.claim({
      destinationId,
      workerId: "worker-1",
      claimedAt: "2026-08-18T00:02:00Z",
      leaseDurationMs: 60_000,
    });
    expect(store.getOutbox(event.eventId, destinationId)).toEqual(claimed[0]);
    expect(store.getOutbox(event.eventId, "hub:backup")?.status).toBe("pending");
    store.acknowledge({
      eventId: event.eventId,
      destinationId,
      workerId: "worker-1",
      acknowledgedAt: "2026-08-18T00:02:01Z",
    });
    expect(store.getOutbox(event.eventId, destinationId)).toMatchObject({
      status: "acknowledged",
      lease: null,
      attemptCount: 1,
    });
    store.close();
    const reopened = await SQLiteEventStore.openReadOnly({ path, projectId });
    expect(reopened.getOutbox(event.eventId, destinationId)?.status).toBe("acknowledged");
    expect(() => reopened.getOutbox("invalid event", destinationId)).toThrowError(
      expect.objectContaining({ code: "invalid_outbox_request" }),
    );
    reopened.close();
  });

  it("counts only outstanding rows for one destination inside an enqueue transaction", async () => {
    const store = await SQLiteEventStore.open({ path: await databasePath(), projectId });
    const first = store.append(draft(1)).event;
    const second = store.append(draft(2)).event;
    store.enqueue(enqueueRequest(first.eventId));
    store.enqueue({ ...enqueueRequest(first.eventId), destinationId: "hub:backup" });

    expect(store.outstandingCount(destinationId)).toBe(1);
    expect(
      store.transact((transaction) => {
        transaction.enqueue(enqueueRequest(second.eventId, 2));
        return transaction.outstandingCount(destinationId);
      }),
    ).toBe(2);

    store.claim({
      destinationId,
      workerId: "worker-1",
      claimedAt: "2026-08-18T00:02:00Z",
      leaseDurationMs: 60_000,
    });
    expect(store.outstandingCount(destinationId)).toBe(2);
    store.acknowledge({
      eventId: first.eventId,
      destinationId,
      workerId: "worker-1",
      acknowledgedAt: "2026-08-18T00:02:01Z",
    });
    expect(store.outstandingCount(destinationId)).toBe(1);
    expect(store.outstandingCount("hub:backup")).toBe(1);
    store.close();
  });

  it("recovers a committed pending item after reopening", async () => {
    const path = await databasePath();
    const first = await SQLiteEventStore.open({ path, projectId });
    const event = first.append(draft()).event;
    first.enqueue(enqueueRequest(event.eventId));
    first.close();

    const reopened = await SQLiteEventStore.open({ path, projectId });
    const claimed = reopened.claim({
      destinationId,
      workerId: "worker-1",
      claimedAt: "2026-08-18T00:02:00Z",
      leaseDurationMs: 1_000,
    });
    expect(claimed).toHaveLength(1);
    expect(claimed[0]).toMatchObject({
      event: { eventId: event.eventId },
      attemptCount: 1,
      status: "leased",
      lease: {
        workerId: "worker-1",
        claimedAt: "2026-08-18T00:02:00.000Z",
        expiresAt: "2026-08-18T00:02:01.000Z",
      },
    });
    reopened.close();
  });

  it("does not give an active lease to another worker and reclaims it after expiry", async () => {
    const path = await databasePath();
    const first = await SQLiteEventStore.open({ path, projectId });
    const second = await SQLiteEventStore.open({ path, projectId });
    const event = first.append(draft()).event;
    first.enqueue(enqueueRequest(event.eventId));

    expect(
      first.claim({
        workerId: "worker-1",
        claimedAt: "2026-08-18T00:02:00Z",
        leaseDurationMs: 1_000,
      }),
    ).toHaveLength(1);
    expect(() =>
      first.acknowledge({
        eventId: event.eventId,
        destinationId,
        workerId: "worker-1",
        acknowledgedAt: "2026-08-18T00:01:59.999Z",
      }),
    ).toThrowError(expect.objectContaining({ code: "outbox_lease_conflict" }));
    expect(
      second.claim({
        workerId: "worker-2",
        claimedAt: "2026-08-18T00:02:00.999Z",
        leaseDurationMs: 1_000,
      }),
    ).toEqual([]);
    const reclaimed = second.claim({
      workerId: "worker-2",
      claimedAt: "2026-08-18T00:02:01Z",
      leaseDurationMs: 1_000,
    });
    expect(reclaimed[0]).toMatchObject({
      attemptCount: 2,
      lease: { workerId: "worker-2" },
    });
    expect(() =>
      first.acknowledge({
        eventId: event.eventId,
        destinationId,
        workerId: "worker-1",
        acknowledgedAt: "2026-08-18T00:02:01.500Z",
      }),
    ).toThrowError(expect.objectContaining({ code: "outbox_lease_conflict" }));
    first.close();
    second.close();
  });

  it("makes acknowledgement idempotent for an already acknowledged item", async () => {
    const store = await SQLiteEventStore.open({ path: await databasePath(), projectId });
    const event = store.append(draft()).event;
    store.enqueue(enqueueRequest(event.eventId));
    store.claim({
      workerId: "worker-1",
      claimedAt: "2026-08-18T00:02:00Z",
      leaseDurationMs: 2_000,
    });
    const request = {
      eventId: event.eventId,
      destinationId,
      workerId: "worker-1",
      acknowledgedAt: "2026-08-18T00:02:01Z",
    };

    expect(store.acknowledge(request)).toEqual({ acknowledged: true });
    expect(store.acknowledge(request)).toEqual({ acknowledged: false });
    expect(store.listOutbox({ status: "acknowledged" })[0]).toMatchObject({
      status: "acknowledged",
      lease: null,
      acknowledgedAt: "2026-08-18T00:02:01.000Z",
    });
    store.close();
  });

  it("purges old acknowledgements without deleting source events or pending work", async () => {
    const store = await SQLiteEventStore.open({ path: await databasePath(), projectId });
    const acknowledgedEvent = store.append(draft(1)).event;
    const pendingEvent = store.append(draft(2)).event;
    store.enqueue(enqueueRequest(acknowledgedEvent.eventId, 1));
    store.enqueue(enqueueRequest(pendingEvent.eventId, 2));
    store.claim({
      workerId: "worker-1",
      claimedAt: "2026-08-18T00:02:00Z",
      leaseDurationMs: 2_000,
      limit: 1,
    });
    store.acknowledge({
      eventId: acknowledgedEvent.eventId,
      destinationId,
      workerId: "worker-1",
      acknowledgedAt: "2026-08-18T00:02:01Z",
    });

    expect(store.purgeAcknowledged({ before: "2026-08-18T00:03:00Z" })).toEqual({ deleted: 1 });
    expect(store.listOutbox()).toEqual([
      expect.objectContaining({ event: pendingEvent, status: "pending" }),
    ]);
    expect(store.get(acknowledgedEvent.eventId)).toEqual(acknowledgedEvent);
    store.close();
  });

  it("rolls an acknowledgement back when a later event append fails", async () => {
    const store = await SQLiteEventStore.open({ path: await databasePath(), projectId });
    const event = store.append(draft()).event;
    store.enqueue(enqueueRequest(event.eventId));
    store.claim({
      workerId: "worker-1",
      claimedAt: "2026-08-18T00:02:00Z",
      leaseDurationMs: 2_000,
    });

    expect(() =>
      store.transact((transaction) => {
        transaction.acknowledge({
          eventId: event.eventId,
          destinationId,
          workerId: "worker-1",
          acknowledgedAt: "2026-08-18T00:02:01Z",
        });
        transaction.append(draft(2, { eventId: "invalid" }));
      }),
    ).toThrowError(expect.objectContaining({ code: "invalid_event" }));
    expect(store.listOutbox()[0]).toMatchObject({ status: "leased" });
    store.close();
  });

  it("reschedules a failed delivery without persisting an error message", async () => {
    const store = await SQLiteEventStore.open({ path: await databasePath(), projectId });
    const event = store.append(draft()).event;
    store.enqueue(enqueueRequest(event.eventId));
    store.claim({
      workerId: "worker-1",
      claimedAt: "2026-08-18T00:02:00Z",
      leaseDurationMs: 2_000,
    });

    expect(
      store.reschedule({
        eventId: event.eventId,
        destinationId,
        workerId: "worker-1",
        failedAt: "2026-08-18T00:02:01Z",
        availableAt: "2026-08-18T00:03:00Z",
        failureCode: "network_unavailable",
      }),
    ).toEqual({ rescheduled: true });
    expect(store.listOutbox()[0]).toMatchObject({
      status: "pending",
      attemptCount: 1,
      lastFailure: {
        code: "network_unavailable",
        failedAt: "2026-08-18T00:02:01.000Z",
      },
    });
    expect(
      store.claim({
        workerId: "worker-2",
        claimedAt: "2026-08-18T00:02:59.999Z",
        leaseDurationMs: 1_000,
      }),
    ).toEqual([]);
    expect(
      store.claim({
        workerId: "worker-2",
        claimedAt: "2026-08-18T00:03:00Z",
        leaseDurationMs: 1_000,
      })[0],
    ).toMatchObject({ attemptCount: 2, lease: { workerId: "worker-2" } });
    store.close();
  });

  it("rejects a raw failure message and preserves the active lease", async () => {
    const store = await SQLiteEventStore.open({ path: await databasePath(), projectId });
    const event = store.append(draft()).event;
    store.enqueue(enqueueRequest(event.eventId));
    store.claim({
      workerId: "worker-1",
      claimedAt: "2026-08-18T00:02:00Z",
      leaseDurationMs: 2_000,
    });

    expect(() =>
      store.reschedule({
        eventId: event.eventId,
        destinationId,
        workerId: "worker-1",
        failedAt: "2026-08-18T00:02:01Z",
        availableAt: "2026-08-18T00:03:00Z",
        failureCode: "HTTP 500: Authorization secret leaked",
      }),
    ).toThrowError(expect.objectContaining({ code: "invalid_outbox_request" }));
    expect(store.listOutbox()[0]).toMatchObject({
      status: "leased",
      lastFailure: null,
    });
    store.close();
  });

  it("claims ready items in stable schedule order", async () => {
    const store = await SQLiteEventStore.open({ path: await databasePath(), projectId });
    const first = store.append(draft(1)).event;
    const second = store.append(draft(2)).event;
    const third = store.append(draft(3)).event;
    store.enqueue({
      ...enqueueRequest(first.eventId, 1),
      availableAt: "2026-08-18T00:05:00Z",
    });
    store.enqueue({
      ...enqueueRequest(second.eventId, 2),
      availableAt: "2026-08-18T00:04:00Z",
    });
    store.enqueue({
      ...enqueueRequest(third.eventId, 3),
      availableAt: "2026-08-18T00:04:00Z",
    });

    const claimed = store.claim({
      workerId: "worker-1",
      claimedAt: "2026-08-18T00:06:00Z",
      leaseDurationMs: 1_000,
      limit: 2,
    });
    expect(claimed.map((item) => item.event.eventId)).toEqual([second.eventId, third.eventId]);
    store.close();
  });

  it("migrates an existing version-one database without losing events", async () => {
    const path = await databasePath();
    const current = await SQLiteEventStore.open({ path, projectId });
    const event = current.append(draft()).event;
    current.close();

    const legacy = new DatabaseSync(path);
    legacy.exec(
      "DROP TABLE outbox; DROP INDEX events_one_work_causality_per_run; DROP INDEX events_one_root_per_work; PRAGMA user_version = 1;",
    );
    legacy.prepare("UPDATE store_meta SET value = '1' WHERE key = 'storage_schema_version'").run();
    legacy.close();

    const migrated = await SQLiteEventStore.open({ path, projectId });
    expect(migrated.get(event.eventId)).toEqual(event);
    expect(migrated.listOutbox()).toEqual([]);
    migrated.close();
    const raw = new DatabaseSync(path);
    expect(sqliteRow(raw.prepare("PRAGMA user_version;").get())?.user_version).toBe(3);
    expect(
      sqliteRow(raw.prepare("SELECT name FROM sqlite_master WHERE name = 'outbox'").get()),
    ).toBeDefined();
    raw.close();
  });

  it("rejects tampered delivery coordinates when they are read or explicitly verified", async () => {
    const path = await databasePath();
    const store = await SQLiteEventStore.open({ path, projectId });
    const event = store.append(draft()).event;
    store.enqueue(enqueueRequest(event.eventId));
    store.close();

    const raw = new DatabaseSync(path);
    raw
      .prepare("UPDATE outbox SET destination_id = ? WHERE event_id = ?")
      .run("invalid destination", event.eventId);
    raw.close();

    // Opening checks only the store binding; the tampered row is rejected wherever it is used.
    const reopened = await SQLiteEventStore.open({ path, projectId });
    try {
      for (const read of [
        () => reopened.listOutbox(),
        () =>
          reopened.claim({
            workerId: "worker-1",
            claimedAt: "2026-08-18T00:02:00Z",
            leaseDurationMs: 1_000,
          }),
        () => reopened.verifyIntegrity(),
      ])
        expect(read).toThrowError(expect.objectContaining({ code: "integrity_failed" }));
    } finally {
      reopened.close();
    }
  });
});
