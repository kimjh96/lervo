import { describe, expect, it } from "vitest";

import type { RepositoryReplicaCycleResult } from "../src/repository-replica-coordinator.js";
import type { RepositoryReplicaFailure } from "../src/repository-replica-failure.js";
import {
  ReplicaRecoverySchedule,
  replicaCycleOutcome,
  replicaFailureOutcome,
} from "../src/repository-replica-recovery-backoff.js";

/** Runs every due recovery cycle with the given outcome and returns when each one ran. */
function drive(
  schedule: ReplicaRecoverySchedule,
  replicaId: string,
  outcome: "current" | "held" | "not_current",
  until: number,
): number[] {
  const runs: number[] = [];
  for (let at = schedule.nextDueAt(); at !== null && at <= until; at = schedule.nextDueAt()) {
    expect(schedule.takeDue(at)).toEqual([replicaId]);
    runs.push(at);
    schedule.observe(replicaId, outcome, at);
  }
  return runs;
}

describe("replica recovery schedule", () => {
  it("doubles a current or held replica's interval up to the ceiling", () => {
    for (const outcome of ["current", "held"] as const) {
      const schedule = new ReplicaRecoverySchedule(["only"], 30_000, 600_000);
      expect(schedule.nextDueAt()).toBeNull();
      schedule.observe("only", outcome, 0);
      expect(drive(schedule, "only", outcome, 3_600_000)).toEqual([
        30_000, 90_000, 210_000, 450_000, 930_000, 1_530_000, 2_130_000, 2_730_000, 3_330_000,
      ]);
      expect(schedule.recoveryIntervalMs).toBe(600_000);
    }
  });

  it("keeps the base interval while cycles change something and after a hint", () => {
    const schedule = new ReplicaRecoverySchedule(["only"], 30_000, 600_000);
    schedule.observe("only", "current", 0);
    drive(schedule, "only", "current", 210_000);
    expect(schedule.recoveryIntervalMs).toBe(480_000);
    schedule.observe("only", "not_current", 220_000);
    expect(schedule.nextDueAt()).toBe(250_000);
    expect(drive(schedule, "only", "not_current", 310_000)).toEqual([250_000, 280_000, 310_000]);
    schedule.observe("only", "current", 320_000);
    expect(schedule.recoveryIntervalMs).toBe(60_000);
    schedule.hint("only");
    expect(schedule.recoveryIntervalMs).toBe(30_000);
  });

  it("never lets one replica's hint or change shorten another replica's interval", () => {
    const schedule = new ReplicaRecoverySchedule(["busy", "idle"], 30_000, 600_000);
    schedule.observe("idle", "held", 0);
    schedule.takeDue(30_000);
    schedule.observe("idle", "held", 30_000);
    schedule.hint("busy");
    schedule.observe("busy", "not_current", 31_000);
    expect(schedule.takeDue(61_000)).toEqual(["busy"]);
    expect(schedule.takeDue(89_999)).toEqual([]);
    expect(schedule.takeDue(90_000)).toEqual(["idle"]);
  });

  it("stops scheduling a replica whose peer was unreachable until the peer gate re-queues it", () => {
    const schedule = new ReplicaRecoverySchedule(["only"], 30_000, 600_000);
    schedule.observe("only", "peer_unreachable", 0);
    expect(schedule.nextDueAt()).toBeNull();
  });

  it("never backs off below its base when the ceiling is lower", () => {
    const schedule = new ReplicaRecoverySchedule(["only"], 60_000, 30_000);
    schedule.observe("only", "current", 0);
    schedule.takeDue(60_000);
    schedule.observe("only", "current", 60_000);
    expect(schedule.nextDueAt()).toBe(120_000);
  });
});

describe("replica cycle outcome", () => {
  const divergent = (firstObserved: boolean): RepositoryReplicaCycleResult => ({
    replicaId: "only",
    status: "divergent",
    localHash: "sha256:local",
    peerHash: "sha256:peer",
    commonHash: null,
    divergence: { divergenceId: "sha256:divergence", firstObserved, event: null },
  });
  const failure = (code: string, stage: RepositoryReplicaFailure["stage"]) => ({
    code,
    stage,
    gitExitCode: null,
    stderrDigest: null,
    causeChain: [],
  });

  it("treats an already observed divergence as held and a new one as a change", () => {
    expect(replicaCycleOutcome({ replicaId: "only", status: "current", snapshotHash: "x" })).toBe(
      "current",
    );
    expect(replicaCycleOutcome(divergent(false))).toBe("held");
    expect(replicaCycleOutcome(divergent(true))).toBe("not_current");
    expect(replicaCycleOutcome({ replicaId: "only", status: "pushed", snapshotHash: "x" })).toBe(
      "not_current",
    );
  });

  it("backs the peer off on transport failures and holds a repeated repository failure", () => {
    expect(
      replicaFailureOutcome(failure("repository_replica_transfer_failed", "transfer"), 1),
    ).toBe("peer_unreachable");
    expect(
      replicaFailureOutcome(failure("repository_replica_transfer_timeout", "transfer"), 7),
    ).toBe("peer_unreachable");
    // A failure the peer runtime reported proves the transport works.
    expect(
      replicaFailureOutcome(failure("repository_replica_snapshot_failed", "snapshot"), 1),
    ).toBe("not_current");
    expect(
      replicaFailureOutcome(failure("repository_replica_snapshot_failed", "snapshot"), 2),
    ).toBe("held");
  });
});
