import { afterEach, describe, expect, it } from "vitest";

import { runOutboundSyncCycle } from "../src/index.js";
import {
  appendEvents,
  destinationId,
  HubFixtureTransport,
  manifest,
  MutableClock,
  openStore,
  peerIdentityHash,
  removeTemporaryStores,
} from "./fixture.js";

const workerId = "sync-worker-1";

function workerOptions(
  store: Awaited<ReturnType<typeof openStore>>,
  transport: HubFixtureTransport,
  clock = new MutableClock(),
) {
  return {
    store,
    transport,
    manifest,
    destinationId,
    expectedPeerIdentityHash: peerIdentityHash,
    workerId,
    clock,
    leaseDurationMs: 30_000,
    retryDelayMs: 5_000,
  };
}

afterEach(removeTemporaryStores);

describe("outbound sync worker", () => {
  it("registers first and acknowledges a leased contiguous batch atomically", async () => {
    const store = await openStore();
    appendEvents(store, 3);
    const transport = new HubFixtureTransport();

    const result = await runOutboundSyncCycle(workerOptions(store, transport));

    expect(result).toMatchObject({
      status: "synchronized",
      registrationStatus: "registered",
      claimedCount: 3,
      acknowledgedCount: 3,
      rescheduledCount: 0,
      acknowledgedBatchCount: 1,
      cursor: { seq: 3 },
    });
    expect(store.listOutbox({ status: "acknowledged" })).toHaveLength(3);
    expect(store.list()).toHaveLength(3);
    expect(transport.batches).toHaveLength(1);

    await expect(runOutboundSyncCycle(workerOptions(store, transport))).resolves.toMatchObject({
      status: "idle",
      registrationStatus: "unchanged",
      claimedCount: 0,
    });
    expect(store.list()).toHaveLength(3);
    store.close();
  });

  it("recovers a durable Hub commit through deterministic duplicate delivery", async () => {
    const store = await openStore();
    appendEvents(store, 2);
    const clock = new MutableClock();
    const transport = new HubFixtureTransport("lose_first_batch_response");

    const first = await runOutboundSyncCycle(workerOptions(store, transport, clock));
    expect(first).toMatchObject({
      status: "retry_scheduled",
      failureCode: "hub_unavailable",
      acknowledgedCount: 0,
      rescheduledCount: 2,
      nextAttemptAt: "2026-08-19T02:00:05.000Z",
    });
    expect(transport.state?.events).toHaveLength(2);
    expect(store.listOutbox({ status: "pending" })).toEqual([
      expect.objectContaining({
        lastFailure: expect.objectContaining({ code: "hub_unavailable" }),
      }),
      expect.objectContaining({
        lastFailure: expect.objectContaining({ code: "hub_unavailable" }),
      }),
    ]);

    clock.value = "2026-08-19T02:00:05.000Z";
    const second = await runOutboundSyncCycle(workerOptions(store, transport, clock));
    expect(second).toMatchObject({
      status: "synchronized",
      registrationStatus: "unchanged",
      claimedCount: 2,
      acknowledgedCount: 2,
      cursor: { seq: 2 },
    });
    expect(transport.batches).toHaveLength(2);
    expect(transport.batches[1]?.batchId).toBe(transport.batches[0]?.batchId);
    expect(store.listOutbox({ status: "acknowledged" })).toHaveLength(2);
    expect(store.list()).toHaveLength(2);
    store.close();
  });

  it("does not trust a batch response from a different authenticated peer", async () => {
    const store = await openStore();
    appendEvents(store, 1);
    const transport = new HubFixtureTransport("wrong_batch_peer");

    const result = await runOutboundSyncCycle(workerOptions(store, transport));

    expect(result).toMatchObject({
      status: "retry_scheduled",
      failureCode: "transport_authentication_failed",
      acknowledgedCount: 0,
      rescheduledCount: 1,
    });
    expect(store.listOutbox()).toEqual([
      expect.objectContaining({
        status: "pending",
        lastFailure: {
          code: "transport_authentication_failed",
          failedAt: "2026-08-19T02:00:00.000Z",
        },
      }),
    ]);
    store.close();
  });

  it("reschedules the exact lease when an acknowledgement is not bound to the batch", async () => {
    const store = await openStore();
    appendEvents(store, 2);
    const transport = new HubFixtureTransport("invalid_first_ack");

    const result = await runOutboundSyncCycle(workerOptions(store, transport));

    expect(result).toMatchObject({
      status: "retry_scheduled",
      failureCode: "invalid_sync_ack",
      claimedCount: 2,
      acknowledgedCount: 0,
      rescheduledCount: 2,
    });
    expect(store.listOutbox()).toEqual([
      expect.objectContaining({
        status: "pending",
        lastFailure: expect.objectContaining({ code: "invalid_sync_ack" }),
      }),
      expect.objectContaining({
        status: "pending",
        lastFailure: expect.objectContaining({ code: "invalid_sync_ack" }),
      }),
    ]);
    store.close();
  });

  it("splits gaps into valid batches and accepts a buffered event without advancing the cursor", async () => {
    const store = await openStore();
    appendEvents(store, 3, [1, 3]);
    const transport = new HubFixtureTransport();

    const result = await runOutboundSyncCycle(workerOptions(store, transport));

    expect(result).toMatchObject({
      status: "synchronized",
      claimedCount: 2,
      acknowledgedCount: 2,
      acknowledgedBatchCount: 2,
      cursor: { seq: 1 },
    });
    expect(transport.batches.map((batch) => [batch.firstSeq, batch.lastSeq])).toEqual([
      [1, 1],
      [3, 3],
    ]);
    expect(transport.state).toMatchObject({ cursor: { seq: 1 }, events: [{ seq: 1 }, { seq: 3 }] });
    expect(store.listOutbox({ status: "acknowledged" })).toHaveLength(2);
    store.close();
  });

  it("keeps an earlier local ack when a later gap batch must be retried", async () => {
    const store = await openStore();
    appendEvents(store, 3, [1, 3]);
    const transport = new HubFixtureTransport("lose_second_batch_response");

    const result = await runOutboundSyncCycle(workerOptions(store, transport));

    expect(result).toMatchObject({
      status: "retry_scheduled",
      failureCode: "hub_unavailable",
      claimedCount: 2,
      acknowledgedCount: 1,
      rescheduledCount: 1,
      acknowledgedBatchCount: 1,
      cursor: { seq: 1 },
    });
    expect(store.listOutbox({ status: "acknowledged" })).toEqual([
      expect.objectContaining({ event: expect.objectContaining({ seq: 1 }) }),
    ]);
    expect(store.listOutbox({ status: "pending" })).toEqual([
      expect.objectContaining({
        event: expect.objectContaining({ seq: 3 }),
        lastFailure: expect.objectContaining({ code: "hub_unavailable" }),
      }),
    ]);
    store.close();
  });

  it("does not claim the outbox when project registration is unavailable", async () => {
    const store = await openStore();
    appendEvents(store, 1);
    const transport = new HubFixtureTransport("registration_unavailable");

    const result = await runOutboundSyncCycle(workerOptions(store, transport));

    expect(result).toEqual({
      status: "registration_deferred",
      failureCode: "hub_unavailable",
      nextAttemptAt: "2026-08-19T02:00:05.000Z",
      claimedCount: 0,
      acknowledgedCount: 0,
      rescheduledCount: 0,
      acknowledgedBatchCount: 0,
    });
    expect(store.listOutbox()).toEqual([
      expect.objectContaining({ status: "pending", attemptCount: 0, lastFailure: null }),
    ]);
    store.close();
  });
});
