import { describe, expect, it } from "vitest";

import { ReplicaPeerBackoff } from "../src/repository-replica-peer-backoff.js";

describe("replica peer back-off", () => {
  it("probes once per doubling period up to the ceiling and reopens on an answer", () => {
    const gate = new ReplicaPeerBackoff(30_000, 600_000);
    expect(gate.closed).toBe(false);
    expect(gate.beginProbe(0)).toBe(false);
    gate.observeUnreachable(0);
    const waits: number[] = [];
    let now = 0;
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const retryAt = gate.retryAt!;
      waits.push(retryAt - now);
      expect(gate.beginProbe(retryAt - 1)).toBe(false);
      expect(gate.beginProbe(retryAt)).toBe(true);
      // Only one probe runs at a time.
      expect(gate.beginProbe(retryAt)).toBe(false);
      now = retryAt;
      gate.observeUnreachable(now);
    }
    expect(waits).toEqual([30_000, 60_000, 120_000, 240_000, 480_000, 600_000, 600_000, 600_000]);
    expect(gate.consecutiveFailures).toBe(9);
    expect(gate.beginProbe(gate.retryAt!)).toBe(true);
    expect(gate.observeReachable()).toBe(true);
    expect(gate.closed).toBe(false);
    expect(gate.consecutiveFailures).toBe(0);
    expect(gate.observeReachable()).toBe(false);
  });

  it("counts cycles that fail during one outage once", () => {
    const gate = new ReplicaPeerBackoff(30_000, 600_000);
    gate.observeUnreachable(0);
    gate.observeUnreachable(10);
    gate.observeUnreachable(20);
    expect(gate.consecutiveFailures).toBe(1);
    expect(gate.retryAt).toBe(30_000);
  });
});
