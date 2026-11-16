import type { RepositoryReplicaCycleResult } from "./repository-replica-coordinator.js";
import {
  isRepositoryReplicaPeerTransportFailure,
  type RepositoryReplicaFailure,
} from "./repository-replica-failure.js";

/**
 * What one reconciliation proved. `current` means both sides were already equal; `held` means the
 * cycle found the same held divergence or the same failure again, so nothing changed since the
 * previous cycle; `peer_unreachable` means the peer transport failed before any repository answer.
 */
export type ReplicaReconcileOutcome = "current" | "held" | "not_current" | "peer_unreachable";

/**
 * ADR-0570: what a finished cycle means for scheduling. A divergence seen again with the same
 * identity is `held`, so it waits a backed-off interval instead of being re-polled every cycle.
 */
export function replicaCycleOutcome(result: RepositoryReplicaCycleResult): ReplicaReconcileOutcome {
  if (result.status === "current") return "current";
  return result.status === "divergent" && !result.divergence.firstObserved ? "held" : "not_current";
}

/**
 * A transport failure backs the whole peer off; the same repository failure seen again in a row
 * is `held` like an unchanged divergence; a new failure keeps the base interval.
 */
export function replicaFailureOutcome(
  failure: RepositoryReplicaFailure,
  consecutiveIdenticalFailures: number,
): ReplicaReconcileOutcome {
  if (isRepositoryReplicaPeerTransportFailure(failure)) return "peer_unreachable";
  return consecutiveIdenticalFailures > 1 ? "held" : "not_current";
}

interface ReplicaRecoveryEntry {
  intervalMs: number;
  /** When the next recovery cycle is due; null while one is queued, running, or peer-gated. */
  dueAt: number | null;
}

/**
 * Per-replica recovery schedule (ADR-0461, ADR-0570). A replica whose cycle ends `current` or
 * `held` waits its interval and then doubles it, up to the ceiling. Any other outcome, or a hint
 * for that replica, returns it to the base. One replica's activity never shortens another's
 * interval, and a recovery cycle is due only after the previous one for that replica finished.
 */
export class ReplicaRecoverySchedule {
  private readonly ceilingMs: number;
  private readonly entries = new Map<string, ReplicaRecoveryEntry>();

  constructor(
    replicaIds: readonly string[],
    private readonly baseMs: number,
    ceilingMs: number,
  ) {
    if (!Number.isSafeInteger(baseMs) || baseMs < 1 || !Number.isSafeInteger(ceilingMs))
      throw new Error("The replica recovery back-off configuration is invalid.");
    this.ceilingMs = Math.max(baseMs, ceilingMs);
    for (const replicaId of replicaIds)
      this.entries.set(replicaId, { intervalMs: baseMs, dueAt: null });
  }

  /** The shortest interval any replica currently waits; informational health only. */
  get recoveryIntervalMs(): number {
    return Math.min(...[...this.entries.values()].map((entry) => entry.intervalMs));
  }

  /** Schedules the replica's next recovery cycle from the outcome of the cycle that just ended. */
  observe(replicaId: string, outcome: ReplicaReconcileOutcome, now: number): void {
    const entry = this.entry(replicaId);
    if (outcome === "peer_unreachable") {
      // The peer gate re-queues every replica when the peer answers again.
      entry.dueAt = null;
      return;
    }
    if (outcome === "not_current") entry.intervalMs = this.baseMs;
    entry.dueAt = now + entry.intervalMs;
    if (outcome === "current" || outcome === "held")
      entry.intervalMs = Math.min(this.ceilingMs, entry.intervalMs * 2);
  }

  /** A change hint for this replica only: its next interval starts again from the base. */
  hint(replicaId: string): void {
    this.entry(replicaId).intervalMs = this.baseMs;
  }

  /** Replicas whose recovery cycle is due; each is marked queued until its cycle ends. */
  takeDue(now: number): string[] {
    const due: string[] = [];
    for (const [replicaId, entry] of this.entries) {
      if (entry.dueAt === null || entry.dueAt > now) continue;
      entry.dueAt = null;
      due.push(replicaId);
    }
    return due;
  }

  nextDueAt(): number | null {
    const due = [...this.entries.values()]
      .map((entry) => entry.dueAt)
      .filter((value): value is number => value !== null);
    return due.length === 0 ? null : Math.min(...due);
  }

  private entry(replicaId: string): ReplicaRecoveryEntry {
    const entry = this.entries.get(replicaId);
    if (entry === undefined) throw new Error("The replica recovery schedule entry is unknown.");
    return entry;
  }
}
