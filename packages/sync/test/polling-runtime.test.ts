import type { AuthenticatedHubTransport } from "@lervo/sync";
import { runOutboundSyncLoop, type OutboundSyncPollingWaitPort } from "@lervo/sync";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  destinationId,
  HubFixtureTransport,
  manifest,
  MutableClock,
  openStore,
  peerIdentityHash,
  removeTemporaryStores,
} from "./fixture.js";

afterEach(removeTemporaryStores);

function worker(
  store: Awaited<ReturnType<typeof openStore>>,
  transport: AuthenticatedHubTransport,
) {
  return {
    store,
    transport,
    manifest,
    destinationId,
    expectedPeerIdentityHash: peerIdentityHash,
    workerId: "sync-polling-runtime",
    clock: new MutableClock(),
    retryDelayMs: 5_000,
  };
}

describe("outbound sync polling lifecycle", () => {
  it("waits until the registration retry time and stops before another cycle", async () => {
    const store = await openStore();
    const controller = new AbortController();
    const delays: number[] = [];
    const wait: OutboundSyncPollingWaitPort = {
      wait: async (delayMs) => {
        delays.push(delayMs);
        controller.abort();
      },
    };

    await expect(
      runOutboundSyncLoop({
        worker: worker(store, new HubFixtureTransport("registration_unavailable")),
        signal: controller.signal,
        wait,
        waitForIdleChange: async () => {
          throw new Error("Deferred retries must not use notifications");
        },
        nowMilliseconds: () => Date.parse("2026-08-19T02:00:00.000Z"),
      }),
    ).resolves.toMatchObject({
      status: "stopped",
      cycleCount: 1,
      lastCycle: { status: "registration_deferred", failureCode: "hub_unavailable" },
    });
    expect(delays).toEqual([5_000]);
    store.close();
  });

  it("uses the bounded idle interval and never overlaps cycles", async () => {
    const store = await openStore();
    const controller = new AbortController();
    let active = 0;
    let maximumActive = 0;
    const fixture = new HubFixtureTransport();
    const transport: AuthenticatedHubTransport = {
      registerProject: async (request) => {
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        await Promise.resolve();
        active -= 1;
        return fixture.registerProject(request);
      },
      sendEventBatch: vi.fn(),
    };
    const wait: OutboundSyncPollingWaitPort = {
      wait: async (delayMs) => {
        expect(delayMs).toBe(750);
        controller.abort();
      },
    };

    await expect(
      runOutboundSyncLoop({
        worker: worker(store, transport),
        signal: controller.signal,
        wait,
        idlePollIntervalMs: 750,
      }),
    ).resolves.toMatchObject({ cycleCount: 1, lastCycle: { status: "idle" } });
    expect(maximumActive).toBe(1);
    store.close();
  });
});

it("uses notifications only for idle cycles and resumes serially after a hint", async () => {
  const store = await openStore();
  const controller = new AbortController();
  const wait = vi.fn(async () => undefined);
  let hints = 0;
  const result = await runOutboundSyncLoop({
    worker: worker(store, new HubFixtureTransport()),
    signal: controller.signal,
    wait: { wait },
    waitForIdleChange: async () => {
      hints += 1;
      if (hints === 2) controller.abort();
    },
  });
  expect(result.cycleCount).toBe(2);
  expect(hints).toBe(2);
  expect(wait).not.toHaveBeenCalled();
  store.close();
});
