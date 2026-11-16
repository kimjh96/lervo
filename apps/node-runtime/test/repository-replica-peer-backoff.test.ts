import { describe, expect, it } from "vitest";

import { ReplicaPeerBackoff } from "../src/repository-replica-peer-backoff.js";

describe("replica peer back-off", () => {
  it("probes once per doubling period up to the ceiling and reopens on an answer", () => {
    const gate = new ReplicaPeerBackoff(30_000, 600_000);
    expect(gate.closed).toBe(false);
    expect(gate.beginProbe(0)).toBe(false);
    expect(gate.observeCycle("only", "peer_unreachable", 0)).toEqual({
      outcome: "peer_unreachable",
      reopened: false,
    });
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
      expect(gate.observeProbe(false, now)).toBe(false);
    }
    expect(waits).toEqual([30_000, 60_000, 120_000, 240_000, 480_000, 600_000, 600_000, 600_000]);
    expect(gate.consecutiveFailures).toBe(9);
    expect(gate.beginProbe(gate.retryAt!)).toBe(true);
    expect(gate.observeProbe(true, now)).toBe(true);
    expect(gate.closed).toBe(false);
    expect(gate.consecutiveFailures).toBe(0);
    expect(gate.takeParked()).toEqual(["only"]);
    expect(gate.takeParked()).toEqual([]);
  });

  it("counts cycles that fail during one outage once and parks each of them", () => {
    const gate = new ReplicaPeerBackoff(30_000, 600_000);
    gate.observeCycle("first", "peer_unreachable", 0);
    gate.observeCycle("second", "peer_unreachable", 10);
    gate.observeCycle("third", "peer_unreachable", 20);
    expect(gate.consecutiveFailures).toBe(1);
    expect(gate.retryAt).toBe(30_000);
    expect(gate.observeCycle("fourth", "current", 25)).toEqual({
      outcome: "current",
      reopened: true,
    });
    expect(gate.takeParked().sort()).toEqual(["first", "second", "third"]);
  });

  it("holds a replica that fails again after the peer answered instead of closing the gate", () => {
    const gate = new ReplicaPeerBackoff(30_000, 600_000);
    gate.observeCycle("broken", "peer_unreachable", 0);
    gate.observeCycle("sibling", "current", 1);
    gate.takeParked();
    for (let attempt = 0; attempt < 3; attempt += 1) {
      expect(gate.observeCycle("broken", "peer_unreachable", 2 + attempt)).toEqual({
        outcome: "held",
        reopened: false,
      });
      expect(gate.closed).toBe(false);
      gate.observeCycle("sibling", "current", 3 + attempt);
    }
    // It stays isolated even after its siblings back off and stop answering in between.
    expect(gate.observeCycle("broken", "peer_unreachable", 10).outcome).toBe("held");
    expect(gate.observeCycle("broken", "peer_unreachable", 11).outcome).toBe("held");
    expect(gate.closed).toBe(false);
    // Another replica's first failure still closes the gate for an outage.
    expect(gate.observeCycle("sibling", "peer_unreachable", 12).outcome).toBe("peer_unreachable");
    expect(gate.closed).toBe(true);
    // A completed cycle clears the replica's history; its next failure is a first one.
    gate.observeProbe(true, 40_000);
    gate.observeCycle("broken", "not_current", 40_001);
    expect(gate.observeCycle("broken", "peer_unreachable", 40_002).outcome).toBe(
      "peer_unreachable",
    );
  });
});
