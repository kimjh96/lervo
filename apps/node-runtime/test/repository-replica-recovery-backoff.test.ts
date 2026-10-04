import { describe, expect, it } from "vitest";

import { ReplicaRecoveryBackoff } from "../src/repository-replica-recovery-backoff.js";

describe("replica recovery back-off", () => {
  it("doubles while every replica is current and stops at the ceiling", () => {
    const backoff = new ReplicaRecoveryBackoff(["first", "second"], 30_000, 600_000);
    expect(backoff.recoveryIntervalMs).toBe(30_000);
    backoff.observe("first", "current");
    // A replica without an observed outcome keeps the base interval.
    expect(backoff.sweep()).toBe(30_000);
    backoff.observe("second", "current");
    const intervals = Array.from({ length: 7 }, () => backoff.sweep());
    expect(intervals).toEqual([60_000, 120_000, 240_000, 480_000, 600_000, 600_000, 600_000]);
  });

  it("returns to the base interval on any non-current outcome or change hint", () => {
    const backoff = new ReplicaRecoveryBackoff(["only"], 30_000, 600_000);
    backoff.observe("only", "current");
    backoff.sweep();
    backoff.sweep();
    expect(backoff.recoveryIntervalMs).toBe(120_000);
    expect(backoff.observe("only", "not_current")).toBe(true);
    expect(backoff.recoveryIntervalMs).toBe(30_000);
    expect(backoff.sweep()).toBe(30_000);
    backoff.observe("only", "current");
    expect(backoff.sweep()).toBe(60_000);
    expect(backoff.reset()).toBe(true);
    expect(backoff.reset()).toBe(false);
    expect(backoff.recoveryIntervalMs).toBe(30_000);
  });

  it("never backs off below its base when the ceiling is lower", () => {
    const backoff = new ReplicaRecoveryBackoff(["only"], 60_000, 30_000);
    backoff.observe("only", "current");
    expect(backoff.sweep()).toBe(60_000);
  });
});
