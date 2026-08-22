import type { AuthenticatedRemoteCommandHubTransport } from "@lervo/remote-command";
import {
  runRemoteCommandReconnectLoop,
  type RemoteCommandPollingWaitPort,
} from "@lervo/remote-command";
import { describe, expect, it, vi } from "vitest";

const destinationId = "hub:polling-runtime";
const peerIdentityHash = `sha256:${"4".repeat(64)}`;
const target = {
  projectId: "prj_polling_runtime",
  projectIdentityHash: `sha256:${"5".repeat(64)}`,
};

function worker(transport: AuthenticatedRemoteCommandHubTransport) {
  return {
    destinationId,
    expectedPeerIdentityHash: peerIdentityHash,
    nodeId: "node_polling_runtime",
    target,
    transport,
    handler: { handle: vi.fn() },
    clock: { now: () => "2026-08-19T00:00:00.000Z" },
    retryDelayMs: 5_000,
  };
}

describe("remote command reconnect polling lifecycle", () => {
  it("waits until the worker retry time and stops without starting another cycle", async () => {
    const controller = new AbortController();
    const delays: number[] = [];
    const wait: RemoteCommandPollingWaitPort = {
      wait: async (delayMs) => {
        delays.push(delayMs);
        controller.abort();
      },
    };
    const transport: AuthenticatedRemoteCommandHubTransport = {
      pullRemoteCommands: async () => { throw new Error("offline"); },
      acknowledgeRemoteCommand: async () => { throw new Error("not called"); },
    };

    await expect(runRemoteCommandReconnectLoop({
      worker: worker(transport),
      signal: controller.signal,
      wait,
      nowMilliseconds: () => Date.parse("2026-08-19T00:00:00.000Z"),
    })).resolves.toMatchObject({
      status: "stopped",
      cycleCount: 1,
      lastCycle: { status: "offline", failureCode: "hub_unavailable" },
    });
    expect(delays).toEqual([5_000]);
  });

  it("uses the bounded idle interval and never runs cycles concurrently", async () => {
    const controller = new AbortController();
    let active = 0;
    let maximumActive = 0;
    const pull = vi.fn(async () => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await Promise.resolve();
      active -= 1;
      return {
        authentication: {
          status: "verified" as const,
          destinationId,
          peerIdentityHash,
        },
        body: [],
      };
    });
    const wait: RemoteCommandPollingWaitPort = {
      wait: async (delayMs) => {
        expect(delayMs).toBe(750);
        controller.abort();
      },
    };

    await expect(runRemoteCommandReconnectLoop({
      worker: worker({
        pullRemoteCommands: pull,
        acknowledgeRemoteCommand: async () => { throw new Error("not called"); },
      }),
      signal: controller.signal,
      wait,
      idlePollIntervalMs: 750,
    })).resolves.toMatchObject({ cycleCount: 1, lastCycle: { status: "idle" } });
    expect(pull).toHaveBeenCalledTimes(1);
    expect(maximumActive).toBe(1);
  });
});
