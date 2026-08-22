import { describe, expect, it, vi } from "vitest";

import { runRemoteControlLoop } from "../src/index.js";

describe("Node remote control loop", () => {
  it("does not request a command lease when policy authentication is unavailable", async () => {
    const abort = new AbortController();
    const runCommandCycle = vi.fn();
    const results: unknown[] = [];
    const result = await runRemoteControlLoop({
      signal: abort.signal,
      runPolicyCycle: async () => ({
        status: "offline",
        failureCode: "transport_authentication_failed",
      }),
      runCommandCycle,
      wait: {
        wait: async () => { abort.abort(); },
      },
      onCycle: (cycle) => { results.push(cycle); },
    });

    expect(result).toMatchObject({
      status: "stopped",
      cycleCount: 1,
      lastCycle: {
        status: "policy_unavailable",
        policy: { failureCode: "transport_authentication_failed" },
      },
    });
    expect(results).toHaveLength(1);
    expect(runCommandCycle).not.toHaveBeenCalled();
  });

  it("runs policy then one command cycle serially and stops before another pull", async () => {
    const abort = new AbortController();
    const order: string[] = [];
    const result = await runRemoteControlLoop({
      signal: abort.signal,
      runPolicyCycle: async () => {
        order.push("policy");
        return { status: "unchanged", snapshotId: null };
      },
      runCommandCycle: async () => {
        order.push("command");
        return { status: "idle", leasedCount: 0, acknowledgedCount: 0 };
      },
      onCycle: () => { abort.abort(); },
    });

    expect(order).toEqual(["policy", "command"]);
    expect(result).toMatchObject({
      cycleCount: 1,
      lastCycle: { status: "command_checked", command: { status: "idle" } },
    });
  });

  it("does not start a command pull when shutdown arrives during policy sync", async () => {
    const abort = new AbortController();
    const runCommandCycle = vi.fn();
    const result = await runRemoteControlLoop({
      signal: abort.signal,
      runPolicyCycle: async () => {
        abort.abort();
        return { status: "unchanged", snapshotId: null };
      },
      runCommandCycle,
    });

    expect(result).toEqual({ status: "stopped", cycleCount: 0, lastCycle: null });
    expect(runCommandCycle).not.toHaveBeenCalled();
  });
});
