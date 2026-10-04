import {
  assertRepositoryReplicaSnapshot,
  reconcileRepositoryReplicas,
  type RepositoryReplicaSnapshot,
} from "@lervo/sync";

import {
  REPOSITORY_REPLICA_ID,
  RepositoryReplicaCoordinatorStateFile,
} from "./repository-replica-coordinator-state.js";
import {
  RepositoryReplicaDivergenceLedger,
  type RepositoryReplicaDivergenceObservation,
  type RepositoryReplicaReconciliationObservation,
} from "./repository-replica-divergence-ledger.js";
import {
  ProjectRepositoryReplicaEvents,
  type RepositoryReplicaEventPort,
} from "./repository-replica-events.js";
import {
  describeRepositoryReplicaFailure,
  type RepositoryReplicaFailure,
  type RepositoryReplicaStage,
} from "./repository-replica-failure.js";
import {
  applyRepositoryReplicaBundle,
  captureRepositoryReplicaSnapshot,
  createRepositoryReplicaBundle,
} from "./repository-replica-git.js";
import {
  mergeRepositoryReplicaBundle,
  type RepositoryReplicaConflictPolicy,
  type RepositoryReplicaMergeResult,
} from "./repository-replica-merge.js";
import {
  recordRepositoryReplicaAttention,
  writeRepositoryReplicaReceipt,
  type RepositoryReplicaReceipt,
} from "./repository-replica-receipt.js";

export type { RepositoryReplicaReceipt } from "./repository-replica-receipt.js";

export interface RepositoryReplicaPeerPort {
  snapshot(repositoryRoot: string): Promise<RepositoryReplicaSnapshot>;
  bundle(repositoryRoot: string, expectedSnapshotHash: string): Promise<Uint8Array>;
  apply(input: {
    repositoryRoot: string;
    bundle: Uint8Array;
    expectedCurrentSnapshotHash: string;
    allowHistoryReplacement?: boolean;
  }): Promise<RepositoryReplicaSnapshot>;
  recordReceipt(input: RepositoryReplicaReceipt): Promise<void>;
  /** Local side only: merges the peer's bundle when both sides changed. */
  merge?(input: {
    repositoryRoot: string;
    bundle: Uint8Array;
    expectedCurrentSnapshotHash: string;
    conflictPolicy?: RepositoryReplicaConflictPolicy;
  }): Promise<RepositoryReplicaMergeResult>;
}

export type RepositoryReplicaCycleResult =
  | {
      replicaId: string;
      status: "current" | "pushed" | "pulled" | "merged";
      snapshotHash: string;
      /** Generated-projection conflicts the merge resolved to the local side. */
      generatedResolutionCount?: number;
      reconciled?: RepositoryReplicaReconciliationObservation;
    }
  | {
      replicaId: string;
      status: "pending";
      commonHash: string;
      localHash: string;
      peerHash: string;
    }
  | {
      replicaId: string;
      status: "divergent";
      localHash: string;
      peerHash: string;
      commonHash: string | null;
      conflict?: {
        reason: "no_common_history" | "conflicting_paths";
        paths: string[];
        pathCount: number;
      };
      divergence: RepositoryReplicaDivergenceObservation;
    };

export class RepositoryReplicaCoordinatorError extends Error {
  constructor(
    readonly code: "repository_replica_config_invalid" | "repository_replica_verification_failed",
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "RepositoryReplicaCoordinatorError";
  }
}

/** A failed cycle with its structured failure and whether the local receipt recorded it. */
export class RepositoryReplicaCycleError extends Error {
  readonly code: string;

  constructor(
    readonly replicaId: string,
    readonly failure: RepositoryReplicaFailure,
    readonly receiptRecorded: boolean,
    options: ErrorOptions,
  ) {
    super(`Repository replica ${replicaId} failed at ${failure.stage}.`, options);
    this.name = "RepositoryReplicaCycleError";
    this.code = failure.code;
  }
}

export class LocalRepositoryReplicaPeer implements RepositoryReplicaPeerPort {
  snapshot(repositoryRoot: string) {
    return captureRepositoryReplicaSnapshot(repositoryRoot);
  }

  bundle(repositoryRoot: string, expectedSnapshotHash: string) {
    return createRepositoryReplicaBundle(repositoryRoot, expectedSnapshotHash);
  }

  apply(input: {
    repositoryRoot: string;
    bundle: Uint8Array;
    expectedCurrentSnapshotHash: string;
  }) {
    return applyRepositoryReplicaBundle(input);
  }

  merge(input: {
    repositoryRoot: string;
    bundle: Uint8Array;
    expectedCurrentSnapshotHash: string;
  }) {
    return mergeRepositoryReplicaBundle(input);
  }

  recordReceipt(input: RepositoryReplicaReceipt): Promise<void> {
    return writeRepositoryReplicaReceipt(input);
  }
}

interface CycleInput {
  replicaId: string;
  localRoot: string;
  peerRoot: string;
  conflictPolicy: RepositoryReplicaConflictPolicy;
}

export class RepositoryReplicaCoordinator {
  private readonly state: RepositoryReplicaCoordinatorStateFile;
  private readonly divergences: RepositoryReplicaDivergenceLedger;
  private readonly now: () => Date;

  constructor(
    private readonly options: {
      stateFile: string;
      local: RepositoryReplicaPeerPort;
      peer: RepositoryReplicaPeerPort;
      events?: RepositoryReplicaEventPort;
      now?: () => Date;
    },
  ) {
    this.now = options.now ?? (() => new Date());
    this.state = new RepositoryReplicaCoordinatorStateFile(options.stateFile);
    this.divergences = new RepositoryReplicaDivergenceLedger({
      state: this.state,
      events: options.events ?? new ProjectRepositoryReplicaEvents(),
      now: this.now,
    });
  }

  private async recordReconciliation(replicaId: string, commonSnapshotHash: string, at: string) {
    await this.state.update((state) => {
      state.replicas[replicaId] = { commonSnapshotHash, reconciledAt: at };
    });
  }

  /**
   * Runs one cycle. A failure is recorded on the local receipt and rethrown as a
   * `RepositoryReplicaCycleError` that carries its code, stage, Git exit code, and stderr digest.
   */
  async reconcile(input: {
    replicaId: string;
    localRoot: string;
    peerRoot: string;
    conflictPolicy?: RepositoryReplicaConflictPolicy;
  }): Promise<RepositoryReplicaCycleResult> {
    if (!REPOSITORY_REPLICA_ID.test(input.replicaId)) {
      throw new RepositoryReplicaCoordinatorError(
        "repository_replica_config_invalid",
        "The repository replica ID is invalid.",
      );
    }
    const stage: { current: RepositoryReplicaStage } = { current: "snapshot" };
    try {
      return await this.cycle({ ...input, conflictPolicy: input.conflictPolicy ?? "hold" }, stage);
    } catch (error) {
      const failure = describeRepositoryReplicaFailure(error, stage.current);
      let receiptRecorded = true;
      try {
        await recordRepositoryReplicaAttention({
          repositoryRoot: input.localRoot,
          replicaId: input.replicaId,
          lastFailure: { ...failure, occurredAt: this.now().toISOString() },
        });
      } catch {
        // The cycle failure stays authoritative; the caller reports the unrecorded receipt.
        receiptRecorded = false;
      }
      throw new RepositoryReplicaCycleError(input.replicaId, failure, receiptRecorded, {
        cause: error,
      });
    }
  }

  private async cycle(
    input: CycleInput,
    stage: { current: RepositoryReplicaStage },
  ): Promise<RepositoryReplicaCycleResult> {
    const state = await this.state.read();
    const [local, peer] = await Promise.all([
      this.options.local.snapshot(input.localRoot),
      this.options.peer.snapshot(input.peerRoot),
    ]);
    assertRepositoryReplicaSnapshot(local);
    assertRepositoryReplicaSnapshot(peer);
    const common = state.replicas[input.replicaId]?.commonSnapshotHash ?? null;
    let decision = reconcileRepositoryReplicas({ local, peer, commonSnapshotHash: common });
    let status: "current" | "pushed" | "pulled" | "merged" = "current";
    let generatedResolutionCount: number | undefined;
    if (decision.status === "divergent") {
      const divergent = decision;
      const held = async (conflict?: {
        reason: "no_common_history" | "conflicting_paths";
        paths: string[];
        pathCount: number;
      }): Promise<RepositoryReplicaCycleResult> => ({
        replicaId: input.replicaId,
        ...divergent,
        ...(conflict === undefined ? {} : { conflict }),
        divergence: await this.divergences.observeDivergence({
          replicaId: input.replicaId,
          localRoot: input.localRoot,
          conflictPolicy: input.conflictPolicy,
          localSnapshotHash: divergent.localHash,
          peerSnapshotHash: divergent.peerHash,
          commonSnapshotHash: divergent.commonHash,
          reason: conflict?.reason ?? "merge_unavailable",
          conflictPaths: conflict?.paths ?? [],
          conflictPathCount: conflict?.pathCount ?? 0,
        }),
      });
      // Both sides changed: merge the peer into the local side, then push the merged result.
      if (this.options.local.merge === undefined) return held();
      // The same snapshot pair under the same policy merges identically, so a held divergence
      // is not re-merged on every cycle.
      const open = await this.divergences.open({
        replicaId: input.replicaId,
        localSnapshotHash: divergent.localHash,
        peerSnapshotHash: divergent.peerHash,
        conflictPolicy: input.conflictPolicy,
      });
      if (open !== null && open.reason !== "merge_unavailable")
        return held({
          reason: open.reason,
          paths: open.conflictPaths,
          pathCount: open.conflictPathCount,
        });
      stage.current = "bundle";
      const peerBundle = await this.options.peer.bundle(input.peerRoot, peer.snapshotHash);
      stage.current = "merge";
      const merged = await this.options.local.merge({
        repositoryRoot: input.localRoot,
        bundle: peerBundle,
        expectedCurrentSnapshotHash: local.snapshotHash,
        conflictPolicy: input.conflictPolicy,
      });
      if (merged.status === "conflict")
        return held({ reason: merged.reason, paths: merged.paths, pathCount: merged.pathCount });
      generatedResolutionCount = merged.generatedResolutionCount;
      decision = reconcileRepositoryReplicas({
        local: merged.snapshot,
        peer,
        commonSnapshotHash: peer.snapshotHash,
      });
      if (decision.status !== "push")
        throw new RepositoryReplicaCoordinatorError(
          "repository_replica_verification_failed",
          "The merged repository replica did not become the push source.",
        );
      status = "merged";
    }
    let transferredSnapshotHash: string | null = null;
    if (decision.status === "push" || decision.status === "pull") {
      const push = decision.status === "push";
      const [source, target] = push
        ? [this.options.local, this.options.peer]
        : [this.options.peer, this.options.local];
      stage.current = "bundle";
      const bundle = await source.bundle(
        push ? input.localRoot : input.peerRoot,
        decision.source.snapshotHash,
      );
      stage.current = push ? "transfer" : "apply";
      const applied = await target.apply({
        repositoryRoot: push ? input.peerRoot : input.localRoot,
        bundle,
        expectedCurrentSnapshotHash:
          decision.status === "push" ? decision.expectedPeerHash : decision.expectedLocalHash,
        allowHistoryReplacement: true,
      });
      stage.current = "verify";
      if (applied.snapshotHash !== decision.source.snapshotHash)
        throw new RepositoryReplicaCoordinatorError(
          "repository_replica_verification_failed",
          `The ${push ? "peer" : "local side"} applied a different repository replica snapshot than requested.`,
        );
      transferredSnapshotHash = applied.snapshotHash;
      if (!push) status = "pulled";
      else if (status !== "merged") status = "pushed";
    }
    stage.current = "verify";
    const reconciledAt = this.now().toISOString();
    if (transferredSnapshotHash !== null) {
      // Persist the exact transferred base before recapturing the active source. If that source
      // advances concurrently, the next cycle remains a one-sided continuation instead of a
      // false dual divergence from the older common snapshot.
      await this.recordReconciliation(input.replicaId, transferredSnapshotHash, reconciledAt);
    }
    const [verifiedLocal, verifiedPeer] = await Promise.all([
      this.options.local.snapshot(input.localRoot),
      this.options.peer.snapshot(input.peerRoot),
    ]);
    if (verifiedLocal.snapshotHash !== verifiedPeer.snapshotHash) {
      if (transferredSnapshotHash !== null)
        return {
          replicaId: input.replicaId,
          status: "pending",
          commonHash: transferredSnapshotHash,
          localHash: verifiedLocal.snapshotHash,
          peerHash: verifiedPeer.snapshotHash,
        };
      throw new RepositoryReplicaCoordinatorError(
        "repository_replica_verification_failed",
        "Repository replicas changed while current parity was being verified.",
      );
    }
    await this.recordReconciliation(input.replicaId, verifiedLocal.snapshotHash, reconciledAt);
    const receipt = (repositoryRoot: string): RepositoryReplicaReceipt => ({
      schemaVersion: 1,
      replicaId: input.replicaId,
      repositoryRoot,
      commonSnapshotHash: verifiedLocal.snapshotHash,
      localSnapshotHash: verifiedLocal.snapshotHash,
      peerSnapshotHash: verifiedPeer.snapshotHash,
      reconciledAt,
      status,
    });
    await Promise.all([
      this.options.local.recordReceipt(receipt(input.localRoot)),
      // The peer imported the merged result, so its receipt keeps the established push status.
      this.options.peer.recordReceipt({
        ...receipt(input.peerRoot),
        status: status === "merged" ? "pushed" : status,
      }),
    ]);
    const reconciled = await this.divergences.observeParity({
      replicaId: input.replicaId,
      localRoot: input.localRoot,
      conflictPolicy: input.conflictPolicy,
      status,
      snapshotHash: verifiedLocal.snapshotHash,
    });
    return {
      replicaId: input.replicaId,
      status,
      snapshotHash: verifiedLocal.snapshotHash,
      ...(generatedResolutionCount === undefined || generatedResolutionCount === 0
        ? {}
        : { generatedResolutionCount }),
      ...(reconciled === null ? {} : { reconciled }),
    };
  }
}
