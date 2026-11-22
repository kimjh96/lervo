import { EventEmitter } from "node:events";
import type { Server } from "node:http";

import type { HubPolicyRenewalStore, HubPolicySigner } from "@lervo/hub-policy";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  attachHubPolicyRenewalLifecycle,
  POLICY_RENEWAL_MAXIMUM_WAIT_MS,
  POLICY_RENEWAL_RETRY_MS,
} from "../src/index.js";

afterEach(() => {
  vi.useRealTimers();
});

function fakeServer() {
  return Object.assign(new EventEmitter(), { listening: false }) as unknown as Server;
}

const signer = {} as HubPolicySigner;

describe("Hub policy renewal lifecycle (ADR-0609)", () => {
  it("runs when listening, sleeps without polling, retries a failure, and stops", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-22T00:00:00.000Z"));
    let calls = 0;
    const store: HubPolicyRenewalStore = {
      listPolicyRenewalHeads: async () => {
        calls += 1;
        if (calls === 1) throw Object.assign(new Error("busy"), { code: "integrity_failed" });
        return [];
      },
      publishPolicySnapshot: async () => {
        throw new Error("no head is due");
      },
    };
    const failures: unknown[] = [];
    const server = fakeServer();
    const lifecycle = attachHubPolicyRenewalLifecycle({
      server,
      store,
      signer,
      onFailure: (error) => failures.push(error),
    });
    expect(calls).toBe(0);
    server.emit("listening");
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toBe(1);
    expect(failures).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(POLICY_RENEWAL_RETRY_MS - 1);
    expect(calls).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(calls).toBe(2);

    // No project has a policy, so the next look is a day away rather than a poll.
    await vi.advanceTimersByTimeAsync(POLICY_RENEWAL_MAXIMUM_WAIT_MS - 1);
    expect(calls).toBe(2);
    server.emit("close");
    await lifecycle.stop();
    await vi.advanceTimersByTimeAsync(POLICY_RENEWAL_MAXIMUM_WAIT_MS);
    expect(calls).toBe(2);
  });
});
