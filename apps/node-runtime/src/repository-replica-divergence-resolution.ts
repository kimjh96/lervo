import {
  reconcileRepositoryReplicas,
  type RepositoryReplicaReconciliation,
  type RepositoryReplicaSnapshot,
} from "@lervo/sync";

import { repositoryReplicaBackupBranch } from "./repository-replica-backup.js";
import type {
  RepositoryReplicaCycleResult,
  RepositoryReplicaPeerPort,
} from "./repository-replica-coordinator.js";
import type { RepositoryReplicaDivergenceLedger } from "./repository-replica-divergence-ledger.js";
import {
  RepositoryReplicaCoordinatorError,
  type RepositoryReplicaStage,
} from "./repository-replica-failure.js";
import type {
  RepositoryReplicaConflictPolicy,
  RepositoryReplicaMergeResult,
} from "./repository-replica-merge.js";

/** The side whose bytes win a conflict; `hold` no longer waits for the owner and keeps local. */
export function preferredReplicaSide(policy: RepositoryReplicaConflictPolicy): "local" | "peer" {
  return policy === "prefer_peer" ? "peer" : "local";
}

export interface RepositoryReplicaBackup {
  branch: string;
  /** The side whose exact snapshot the branch holds. */
  side: "local" | "peer";
  snapshotHash: string;
}

export type RepositoryReplicaPreferenceResult =
  | RepositoryReplicaResolvedPreference
  | {
      status: "held";
      reason:
        "stronger_check_disagreement" | "backup_unavailable" | "notice_unavailable" | "owner_hold";
    };

export interface RepositoryReplicaResolvedPreference {
  status: "resolved";
  policy: "prefer_local" | "prefer_peer";
  backup: RepositoryReplicaBackup;
  /** The transfer the coordinator still performs; a merge already changed the local side. */
  decision: RepositoryReplicaReconciliation;
  merged: RepositoryReplicaSnapshot | null;
  generatedResolutionCount?: number;
}

/**
 * ADR-0561 for a replica conflict: save the losing side to a backup branch on the losing side's
 * own host, where the undo restores it; confirm with two agreeing checks that the backup holds the
 * exact losing snapshot and that neither side moved since the decision; record the notice with its
 * undo; and only then prefer the chosen side. The merge keeps every non-conflicting change from
 * both sides; only when no merge is possible does the chosen side replace the other. An owner
 * hold, a failed backup, a disagreeing check, or an unrecorded notice changes nothing.
 */
export async function preferRepositoryReplicaSide(input: {
  replicaId: string;
  divergenceId: string;
  policy: RepositoryReplicaConflictPolicy;
  localRoot: string;
  peerRoot: string;
  localSnapshot: RepositoryReplicaSnapshot;
  peerSnapshot: RepositoryReplicaSnapshot;
  peerBundle: Uint8Array;
  local: RepositoryReplicaPeerPort;
  peer: RepositoryReplicaPeerPort;
  /** Whether the owner holds the local repository; a held conflict stays open. */
  held: () => Promise<boolean>;
  /** Persists the notice with its undo; it runs before either side changes. */
  notice: (backup: RepositoryReplicaBackup) => Promise<void>;
}): Promise<RepositoryReplicaPreferenceResult> {
  if (await input.held()) return { status: "held", reason: "owner_hold" };
  const preferred = preferredReplicaSide(input.policy);
  const losingSide = preferred === "local" ? "peer" : "local";
  const losing = losingSide === "peer" ? input.peerSnapshot : input.localSnapshot;
  const losingPort = losingSide === "peer" ? input.peer : input.local;
  if (losingPort.backup === undefined || input.local.merge === undefined)
    return { status: "held", reason: "backup_unavailable" };
  let backup: RepositoryReplicaBackup;
  try {
    const saved = await losingPort.backup({
      repositoryRoot: losingSide === "peer" ? input.peerRoot : input.localRoot,
      branch: repositoryReplicaBackupBranch(input.replicaId, input.divergenceId),
      bundle: null,
      expectedSnapshotHash: losing.snapshotHash,
    });
    backup = { ...saved, side: losingSide };
  } catch {
    return { status: "held", reason: "backup_unavailable" };
  }
  // Two independent checks must agree before either repository changes: the backup verifiably
  // holds the losing snapshot, and a fresh observation of both sides still matches the decision.
  const [localNow, peerNow] = await Promise.all([
    input.local.snapshot(input.localRoot),
    input.peer.snapshot(input.peerRoot),
  ]);
  if (
    backup.snapshotHash !== losing.snapshotHash ||
    localNow.snapshotHash !== input.localSnapshot.snapshotHash ||
    peerNow.snapshotHash !== input.peerSnapshot.snapshotHash
  )
    return { status: "held", reason: "stronger_check_disagreement" };
  try {
    await input.notice(backup);
  } catch {
    return { status: "held", reason: "notice_unavailable" };
  }
  const policy = preferred === "local" ? "prefer_local" : "prefer_peer";
  const merged = await input.local.merge({
    repositoryRoot: input.localRoot,
    bundle: input.peerBundle,
    expectedCurrentSnapshotHash: input.localSnapshot.snapshotHash,
    conflictPolicy: policy,
  });
  if (merged.status === "merged")
    return {
      status: "resolved",
      policy,
      backup,
      merged: merged.snapshot,
      generatedResolutionCount: merged.generatedResolutionCount,
      decision:
        merged.snapshot.snapshotHash === input.peerSnapshot.snapshotHash
          ? { status: "current", snapshotHash: merged.snapshot.snapshotHash }
          : {
              status: "push",
              source: merged.snapshot,
              expectedPeerHash: input.peerSnapshot.snapshotHash,
            },
    };
  // No common history or a conflict a side preference cannot settle: the chosen side replaces
  // the other wholesale; the backup branch keeps the replaced side.
  return {
    status: "resolved",
    policy,
    backup,
    merged: null,
    decision:
      preferred === "local"
        ? {
            status: "push",
            source: input.localSnapshot,
            expectedPeerHash: input.peerSnapshot.snapshotHash,
          }
        : {
            status: "pull",
            source: input.peerSnapshot,
            expectedLocalHash: input.localSnapshot.snapshotHash,
          },
  };
}

type DivergentResult = Extract<RepositoryReplicaCycleResult, { status: "divergent" }>;
type ConflictReport = {
  reason: "no_common_history" | "conflicting_paths";
  paths: string[];
  pathCount: number;
};

/**
 * Resolves a cycle in which both replicas changed. A clean merge goes on to the push; a conflict
 * is recorded once as a divergence and then settled by `preferRepositoryReplicaSide`. Only a
 * missing merge port or a held preference leaves the divergence open.
 */
export async function resolveRepositoryReplicaDivergence(input: {
  replicaId: string;
  localRoot: string;
  peerRoot: string;
  conflictPolicy: RepositoryReplicaConflictPolicy;
  divergent: Extract<RepositoryReplicaReconciliation, { status: "divergent" }>;
  local: RepositoryReplicaSnapshot;
  peer: RepositoryReplicaSnapshot;
  localPort: RepositoryReplicaPeerPort;
  peerPort: RepositoryReplicaPeerPort;
  divergences: RepositoryReplicaDivergenceLedger;
  stage: { current: RepositoryReplicaStage };
  held: () => Promise<boolean>;
  notice: (backup: RepositoryReplicaBackup) => Promise<void>;
}): Promise<
  | { kind: "held"; result: DivergentResult }
  | {
      kind: "continue";
      decision: RepositoryReplicaReconciliation;
      status: "current" | "pushed" | "pulled" | "merged";
      generatedResolutionCount: number | undefined;
      transferredSnapshotHash: string | null;
      preference: RepositoryReplicaResolvedPreference | null;
    }
> {
  const { divergent, local, peer } = input;
  const held = async (conflict?: ConflictReport): Promise<DivergentResult> => ({
    replicaId: input.replicaId,
    ...divergent,
    ...(conflict === undefined ? {} : { conflict }),
    divergence: await input.divergences.observeDivergence({
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
  if (input.localPort.merge === undefined) return { kind: "held", result: await held() };
  // The same snapshot pair merges identically, so a recorded conflict is not merged again.
  const open = await input.divergences.open({
    replicaId: input.replicaId,
    localSnapshotHash: divergent.localHash,
    peerSnapshotHash: divergent.peerHash,
    conflictPolicy: input.conflictPolicy,
  });
  input.stage.current = "bundle";
  const peerBundle = await input.peerPort.bundle(input.peerRoot, peer.snapshotHash);
  input.stage.current = "merge";
  // A clean merge first: only generated projections resolve to the local side without a backup.
  const merged: RepositoryReplicaMergeResult =
    open !== null && open.reason !== "merge_unavailable"
      ? {
          status: "conflict",
          reason: open.reason,
          paths: open.conflictPaths,
          pathCount: open.conflictPathCount,
        }
      : await input.localPort.merge({
          repositoryRoot: input.localRoot,
          bundle: peerBundle,
          expectedCurrentSnapshotHash: local.snapshotHash,
          conflictPolicy: "hold",
        });
  if (merged.status === "merged") {
    const decision = reconcileRepositoryReplicas({
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
    return {
      kind: "continue",
      decision,
      status: decision.status === "current" ? "pulled" : "merged",
      generatedResolutionCount: merged.generatedResolutionCount,
      transferredSnapshotHash: decision.status === "current" ? merged.snapshot.snapshotHash : null,
      preference: null,
    };
  }
  const observed = await held({
    reason: merged.reason,
    paths: merged.paths,
    pathCount: merged.pathCount,
  });
  // ADR-0561: never wait for the owner; back up the losing side, then prefer the chosen one.
  const resolved = await preferRepositoryReplicaSide({
    replicaId: input.replicaId,
    divergenceId: observed.divergence.divergenceId,
    policy: input.conflictPolicy,
    localRoot: input.localRoot,
    peerRoot: input.peerRoot,
    localSnapshot: local,
    peerSnapshot: peer,
    peerBundle,
    local: input.localPort,
    peer: input.peerPort,
    held: input.held,
    notice: input.notice,
  });
  if (resolved.status === "held")
    return { kind: "held", result: { ...observed, heldReason: resolved.reason } };
  const mergedSnapshot = resolved.merged;
  return {
    kind: "continue",
    decision: resolved.decision,
    status:
      mergedSnapshot === null
        ? "current"
        : resolved.decision.status === "current"
          ? "pulled"
          : "merged",
    generatedResolutionCount: resolved.generatedResolutionCount,
    transferredSnapshotHash:
      mergedSnapshot !== null && resolved.decision.status === "current"
        ? mergedSnapshot.snapshotHash
        : null,
    preference: resolved,
  };
}
