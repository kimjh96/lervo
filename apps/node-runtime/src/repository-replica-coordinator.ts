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
  RepositoryReplicaCoordinatorError,
  RepositoryReplicaCycleError,
  type RepositoryReplicaStage,
} from "./repository-replica-failure.js";
import {
  RepositoryReplicaCaptureCompatibility,
  type RepositoryReplicaCaptureVersionPort,
} from "./repository-replica-capture-compatibility.js";
import {
  ReplicaKnowledgeSupersessionExchange,
  type RepositoryReplicaKnowledgeSupersessionPort,
} from "./repository-replica-knowledge-supersession.js";
import type {
  RepositoryReplicaConflictPolicy,
  RepositoryReplicaMergeResult,
} from "./repository-replica-merge.js";
import {
  recordRepositoryReplicaAttention,
  type RepositoryReplicaReceipt,
} from "./repository-replica-receipt.js";

export type { RepositoryReplicaReceipt } from "./repository-replica-receipt.js";
export {
  RepositoryReplicaCoordinatorError,
  RepositoryReplicaCycleError,
} from "./repository-replica-failure.js";

export interface RepositoryReplicaPeerPort
  extends RepositoryReplicaKnowledgeSupersessionPort, RepositoryReplicaCaptureVersionPort {
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

/**
 * Why a cycle runs. A `recovery` cycle comes from the reconciliation timer with no observed
 * change; only such a cycle may skip rewriting an identical peer receipt.
 */
export type RepositoryReplicaCycleTrigger = "change" | "recovery";

interface CycleInput {
  replicaId: string;
  localRoot: string;
  peerRoot: string;
  conflictPolicy: RepositoryReplicaConflictPolicy;
  trigger: RepositoryReplicaCycleTrigger;
}

/** Receipt identity without its timestamp; equal identities prove the same parity. */
function receiptIdentity(receipt: RepositoryReplicaReceipt): string {
  const { reconciledAt: _reconciledAt, ...identity } = receipt;
  return JSON.stringify(identity);
}

export class RepositoryReplicaCoordinator {
  private readonly state: RepositoryReplicaCoordinatorStateFile;
  private readonly divergences: RepositoryReplicaDivergenceLedger;
  private readonly now: () => Date;
  private readonly capture: RepositoryReplicaCaptureCompatibility;
  /** The last peer receipt identity this process wrote, per replica. */
  private readonly peerReceipts = new Map<string, string>();
  private readonly supersession = new ReplicaKnowledgeSupersessionExchange(() =>
    this.now().getTime(),
  );

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
    this.capture = new RepositoryReplicaCaptureCompatibility(() => this.now().getTime());
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
    trigger?: RepositoryReplicaCycleTrigger;
  }): Promise<RepositoryReplicaCycleResult> {
    if (!REPOSITORY_REPLICA_ID.test(input.replicaId)) {
      throw new RepositoryReplicaCoordinatorError(
        "repository_replica_config_invalid",
        "The repository replica ID is invalid.",
      );
    }
    const stage: { current: RepositoryReplicaStage } = { current: "snapshot" };
    try {
      return await this.cycle(
        {
          ...input,
          conflictPolicy: input.conflictPolicy ?? "hold",
          trigger: input.trigger ?? "change",
        },
        stage,
      );
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
    const observe = () =>
      Promise.all([
        this.options.local.snapshot(input.localRoot),
        this.options.peer.snapshot(input.peerRoot),
      ]);
    let [local, peer] = await observe();
    // Superseded knowledge commits leave both branches before either side's history can move.
    stage.current = "supersession";
    const supersession = await this.supersession.exchange({
      ...input,
      local: this.options.local,
      peer: this.options.peer,
      snapshotHashes: [local.snapshotHash, peer.snapshotHash],
    });
    stage.current = "snapshot";
    if (supersession.droppedCommitCount > 0) [local, peer] = await observe();
    assertRepositoryReplicaSnapshot(local);
    assertRepositoryReplicaSnapshot(peer);
    stage.current = "protocol";
    await this.capture.assert({ local: this.options.local, peer: this.options.peer });
    stage.current = "snapshot";
    const common = state.replicas[input.replicaId]?.commonSnapshotHash ?? null;
    let decision = reconcileRepositoryReplicas({ local, peer, commonSnapshotHash: common });
    let status: "current" | "pushed" | "pulled" | "merged" = "current";
    let generatedResolutionCount: number | undefined;
    let transferredSnapshotHash: string | null = null;
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
      // A merge whose result is exactly the peer's state, such as a fast-forward after the local
      // side dropped superseded commits, imported the peer and leaves nothing to push.
      if (decision.status !== "push" && decision.status !== "current")
        throw new RepositoryReplicaCoordinatorError(
          "repository_replica_verification_failed",
          "The merged repository replica did not become the push source.",
        );
      if (decision.status === "current") transferredSnapshotHash = merged.snapshot.snapshotHash;
      status = decision.status === "current" ? "pulled" : "merged";
    }
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
    // Without a transfer both sides were just observed equal; observing them again proves nothing
    // more, and a later change reaches the next cycle through its hint or recovery sweep.
    const [verifiedLocal, verifiedPeer] =
      transferredSnapshotHash === null ? [local, peer] : await observe();
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
    // The peer imported the merged result, so its receipt keeps the established push status.
    const peerReceipt: RepositoryReplicaReceipt = {
      ...receipt(input.peerRoot),
      status: status === "merged" ? "pushed" : status,
    };
    const peerIdentity = receiptIdentity(peerReceipt);
    const peerReceiptUnchanged =
      input.trigger === "recovery" &&
      status === "current" &&
      this.peerReceipts.get(input.replicaId) === peerIdentity;
    await Promise.all([
      this.options.local.recordReceipt(receipt(input.localRoot)),
      peerReceiptUnchanged
        ? Promise.resolve()
        : this.options.peer.recordReceipt(peerReceipt).then(() => {
            this.peerReceipts.set(input.replicaId, peerIdentity);
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
