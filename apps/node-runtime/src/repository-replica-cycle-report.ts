import type { RepositoryReplicaCycleResult } from "./repository-replica-coordinator.js";
import type { RepositoryReplicaEventDisposition } from "./repository-replica-events.js";
import {
  formatRepositoryReplicaFailure,
  type RepositoryReplicaFailure,
  type RepositoryReplicaStage,
} from "./repository-replica-failure.js";

export type RepositoryReplicaHealthEntry =
  | { status: "current" | "pending" }
  | { status: "divergent"; divergenceId: string }
  | {
      status: "failed";
      failureCode: string;
      failureStage: RepositoryReplicaStage;
      consecutiveFailures: number;
    };

/** Coordinator health: `degraded` while any replica is divergent or failing. */
export interface RepositoryReplicaHealthSnapshot {
  schemaVersion: 1;
  status: "ready" | "degraded";
  updatedAt: string;
  /** Shortest per-replica recovery interval in watch mode; informational only. */
  recoveryIntervalMs?: number;
  /** Present only while the unreachable peer is backed off (ADR-0570). */
  peer?: { status: "backing_off"; consecutiveFailures: number; retryAt: string };
  /** Stable advisory codes about the coordinator configuration, such as a per-call launcher. */
  advisories?: string[];
  replicas: Record<string, RepositoryReplicaHealthEntry>;
}

/** Watch-mode context the health snapshot carries beside the replica entries. */
export interface RepositoryReplicaHealthContext {
  recoveryIntervalMs?: number | undefined;
  peer?: RepositoryReplicaHealthSnapshot["peer"] | undefined;
  advisories?: string[] | undefined;
}

export interface RepositoryReplicaReportLines {
  stdout: string[];
  stderr: string[];
}

interface FailureStreak {
  fingerprint: string;
  count: number;
  failure: RepositoryReplicaFailure;
}

function eventNote(event: RepositoryReplicaEventDisposition | null): string {
  if (event === null || event.status !== "unavailable") return "";
  return ` (canonical event unavailable: ${event.failureCode})`;
}

function isPowerOfTen(value: number): boolean {
  return value >= 10 && 10 ** Math.round(Math.log10(value)) === value;
}

/**
 * Turns cycle outcomes into log lines and health. In watch mode each divergence identity and each
 * distinct failure is logged once; repeats only advance a counter reported at powers of ten.
 */
export class RepositoryReplicaCycleReporter {
  private readonly health = new Map<string, RepositoryReplicaHealthEntry>();
  private readonly failures = new Map<string, FailureStreak>();

  constructor(private readonly watch: boolean) {}

  observeResult(result: RepositoryReplicaCycleResult): RepositoryReplicaReportLines {
    const lines: RepositoryReplicaReportLines = { stdout: [], stderr: [] };
    const streak = this.failures.get(result.replicaId);
    if (streak !== undefined) {
      this.failures.delete(result.replicaId);
      lines.stdout.push(
        `Repository replica ${result.replicaId} recovered after ${streak.count} failed cycle(s).`,
      );
    }
    if (result.status === "divergent") {
      this.health.set(result.replicaId, {
        status: "divergent",
        divergenceId: result.divergence.divergenceId,
      });
      if (this.watch && !result.divergence.firstObserved) return lines;
      const conflict =
        result.conflict === undefined
          ? "no merge attempted"
          : result.conflict.reason === "no_common_history"
            ? "no common history"
            : `${result.conflict.pathCount} conflicting path(s): ${result.conflict.paths.join(", ")}`;
      lines.stderr.push(
        `Repository replica ${result.replicaId} is divergent (${result.localHash} != ${result.peerHash}; common ${result.commonHash ?? "none"}; ${conflict}; divergence ${result.divergence.divergenceId})${eventNote(result.divergence.event)}.`,
      );
      return lines;
    }
    this.health.set(result.replicaId, {
      status: result.status === "pending" ? "pending" : "current",
    });
    // A source advanced after an exact transfer. Its watcher or the bounded recovery sweep
    // continues from the newly persisted common base without manufacturing divergence.
    if (result.status === "pending") return lines;
    if (result.status !== "current") {
      const generated =
        result.generatedResolutionCount === undefined
          ? ""
          : ` (${result.generatedResolutionCount} generated path conflict(s) resolved to the local side)`;
      lines.stdout.push(
        `Repository replica ${result.replicaId} ${result.status} at ${result.snapshotHash}${generated}.`,
      );
    }
    if (result.reconciled !== undefined) {
      lines.stdout.push(
        `Repository replica ${result.replicaId} reconciled divergence ${result.reconciled.divergenceId} by ${result.reconciled.strategy}${eventNote(result.reconciled.event)}.`,
      );
    }
    return lines;
  }

  observeFailure(
    replicaId: string,
    failure: RepositoryReplicaFailure,
    receiptRecorded: boolean,
  ): RepositoryReplicaReportLines {
    const fingerprint = JSON.stringify([
      failure.code,
      failure.stage,
      failure.gitExitCode,
      failure.stderrDigest,
    ]);
    const previous = this.failures.get(replicaId);
    const streak: FailureStreak =
      previous?.fingerprint === fingerprint
        ? { ...previous, count: previous.count + 1 }
        : { fingerprint, count: 1, failure };
    this.failures.set(replicaId, streak);
    this.health.set(replicaId, {
      status: "failed",
      failureCode: failure.code,
      failureStage: failure.stage,
      consecutiveFailures: streak.count,
    });
    const receipt = receiptRecorded ? "" : " The local receipt could not record this failure.";
    if (!this.watch || streak.count === 1) {
      return {
        stdout: [],
        stderr: [
          `Repository replica ${replicaId} failed: ${formatRepositoryReplicaFailure(failure)}.${receipt}`,
        ],
      };
    }
    return {
      stdout: [],
      stderr: isPowerOfTen(streak.count)
        ? [
            `Repository replica ${replicaId} failure ${failure.code} at ${failure.stage} repeated ${streak.count} times.`,
          ]
        : [],
    };
  }

  /** Consecutive identical failures of the replica's latest cycles; zero after a success. */
  failureStreak(replicaId: string): number {
    return this.failures.get(replicaId)?.count ?? 0;
  }

  snapshot(
    now: Date,
    context: RepositoryReplicaHealthContext = {},
  ): RepositoryReplicaHealthSnapshot {
    const replicas = Object.fromEntries(
      [...this.health.entries()].sort(([left], [right]) => left.localeCompare(right)),
    );
    return {
      schemaVersion: 1,
      status: Object.values(replicas).some(
        (entry) => entry.status === "divergent" || entry.status === "failed",
      )
        ? "degraded"
        : "ready",
      updatedAt: now.toISOString(),
      ...(context.recoveryIntervalMs === undefined
        ? {}
        : { recoveryIntervalMs: context.recoveryIntervalMs }),
      ...(context.peer === undefined ? {} : { peer: context.peer }),
      ...(context.advisories === undefined || context.advisories.length === 0
        ? {}
        : { advisories: context.advisories }),
      replicas,
    };
  }
}
