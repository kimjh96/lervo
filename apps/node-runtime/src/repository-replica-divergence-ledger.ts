import {
  calculateRepositoryReplicaDivergenceId,
  type RepositoryReplicaDivergenceReason,
  type RepositoryReplicaOpenDivergence,
} from "@lervo/sync";

import type {
  RepositoryReplicaCoordinatorStateFile,
  RepositoryReplicaDivergenceEntry,
} from "./repository-replica-coordinator-state.js";
import type {
  RepositoryReplicaEventDisposition,
  RepositoryReplicaEventPort,
  RepositoryReplicaReconciliationStrategy,
} from "./repository-replica-events.js";
import type { RepositoryReplicaConflictPolicy } from "./repository-replica-merge.js";
import { recordRepositoryReplicaAttention } from "./repository-replica-receipt.js";

const MAXIMUM_RECORDED_CONFLICT_PATHS = 16;

export interface RepositoryReplicaDivergenceObservation {
  divergenceId: string;
  /** True only for the first cycle that observes this identity; later cycles stay silent. */
  firstObserved: boolean;
  /** Null when an earlier cycle already recorded the canonical event. */
  event: RepositoryReplicaEventDisposition | null;
}

export interface RepositoryReplicaReconciliationObservation {
  divergenceId: string;
  strategy: RepositoryReplicaReconciliationStrategy;
  event: RepositoryReplicaEventDisposition;
}

function strategyFor(
  status: "current" | "pushed" | "pulled" | "merged",
  policy: RepositoryReplicaConflictPolicy,
): RepositoryReplicaReconciliationStrategy {
  if (status !== "merged") return "external";
  return policy === "hold" ? "merge" : policy;
}

function settled(disposition: RepositoryReplicaEventDisposition): boolean {
  return disposition.status === "recorded" || disposition.status === "duplicate";
}

/**
 * Tracks one open divergence identity per replica (ADR-0456): it records `diverged` once, keeps
 * the local receipt's attention projection current, and records `reconciled` when parity returns.
 */
export class RepositoryReplicaDivergenceLedger {
  constructor(
    private readonly options: {
      state: RepositoryReplicaCoordinatorStateFile;
      events: RepositoryReplicaEventPort;
      now: () => Date;
    },
  ) {}

  /** The open divergence a later cycle can reuse without repeating an unchanged merge. */
  async open(input: {
    replicaId: string;
    localSnapshotHash: string;
    peerSnapshotHash: string;
    conflictPolicy: RepositoryReplicaConflictPolicy;
  }): Promise<RepositoryReplicaDivergenceEntry | null> {
    const entry = (await this.options.state.read()).divergences?.[input.replicaId];
    return entry !== undefined &&
      entry.divergenceId ===
        calculateRepositoryReplicaDivergenceId(input.localSnapshotHash, input.peerSnapshotHash) &&
      entry.conflictPolicy === input.conflictPolicy
      ? entry
      : null;
  }

  async observeDivergence(input: {
    replicaId: string;
    localRoot: string;
    conflictPolicy: RepositoryReplicaConflictPolicy;
    localSnapshotHash: string;
    peerSnapshotHash: string;
    commonSnapshotHash: string | null;
    reason: RepositoryReplicaDivergenceReason;
    conflictPaths: string[];
    conflictPathCount: number;
  }): Promise<RepositoryReplicaDivergenceObservation> {
    const divergenceId = calculateRepositoryReplicaDivergenceId(
      input.localSnapshotHash,
      input.peerSnapshotHash,
    );
    const previous = (await this.options.state.read()).divergences?.[input.replicaId];
    const firstObserved = previous?.divergenceId !== divergenceId;
    const divergence: RepositoryReplicaOpenDivergence =
      !firstObserved && previous !== undefined
        ? previous
        : {
            divergenceId,
            replicaId: input.replicaId,
            localSnapshotHash: input.localSnapshotHash,
            peerSnapshotHash: input.peerSnapshotHash,
            commonSnapshotHash: input.commonSnapshotHash,
            reason: input.reason,
            conflictPathCount: input.conflictPathCount,
            conflictPaths: input.conflictPaths.slice(0, MAXIMUM_RECORDED_CONFLICT_PATHS),
            openedAt: this.options.now().toISOString(),
          };
    if (!firstObserved && previous?.divergedEventRecorded === true) {
      return { divergenceId, firstObserved, event: null };
    }
    const event = await this.options.events.recordDiverged({
      repositoryRoot: input.localRoot,
      divergence,
      conflictPolicy: input.conflictPolicy,
      occurredAt: divergence.openedAt,
    });
    await this.options.state.update((state) => {
      state.divergences = {
        ...state.divergences,
        [input.replicaId]: {
          ...divergence,
          conflictPolicy: input.conflictPolicy,
          divergedEventRecorded: settled(event),
        },
      };
    });
    if (firstObserved) {
      await recordRepositoryReplicaAttention({
        repositoryRoot: input.localRoot,
        replicaId: input.replicaId,
        lastFailure: null,
        openDivergence: divergence,
      });
    }
    return { divergenceId, firstObserved, event };
  }

  /** Records `reconciled` for the replica's open divergence; null when none was open. */
  async observeParity(input: {
    replicaId: string;
    localRoot: string;
    conflictPolicy: RepositoryReplicaConflictPolicy;
    /** ADR-0561: the side preference the coordinator applied after saving the losing side. */
    strategy?: "prefer_local" | "prefer_peer";
    status: "current" | "pushed" | "pulled" | "merged";
    snapshotHash: string;
  }): Promise<RepositoryReplicaReconciliationObservation | null> {
    const entry = (await this.options.state.read()).divergences?.[input.replicaId];
    if (entry === undefined) return null;
    const occurredAt = this.options.now().toISOString();
    const diverged = entry.divergedEventRecorded
      ? null
      : await this.options.events.recordDiverged({
          repositoryRoot: input.localRoot,
          divergence: entry,
          conflictPolicy: entry.conflictPolicy,
          occurredAt: entry.openedAt,
        });
    const strategy = input.strategy ?? strategyFor(input.status, input.conflictPolicy);
    const event =
      diverged !== null && !settled(diverged)
        ? diverged
        : await this.options.events.recordReconciled({
            repositoryRoot: input.localRoot,
            divergence: entry,
            conflictPolicy: input.conflictPolicy,
            strategy,
            resultSnapshotHash: input.snapshotHash,
            occurredAt,
          });
    const divergedRecorded =
      entry.divergedEventRecorded || (diverged !== null && settled(diverged));
    await this.options.state.update((state) => {
      const current = state.divergences?.[input.replicaId];
      if (current?.divergenceId !== entry.divergenceId) return;
      // Without a recorded `diverged` event there is no canonical divergence to pair, so the
      // entry closes; otherwise a failed `reconciled` append is retried by the next parity cycle.
      if (settled(event) || !divergedRecorded) delete state.divergences![input.replicaId];
      else current.divergedEventRecorded = true;
    });
    return { divergenceId: entry.divergenceId, strategy, event };
  }
}
