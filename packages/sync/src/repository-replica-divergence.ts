import { createHash } from "node:crypto";

/** The repository-local replica receipt, written by the coordinator for each side it reconciles. */
export const REPOSITORY_REPLICA_RECEIPT_PATH = ".lervo/state/repository-replica.json";

const SNAPSHOT_HASH = /^sha256:[a-f0-9]{64}$/u;
const REPLICA_ID = /^[a-z][a-z0-9_-]{1,63}$/u;
const MAXIMUM_CONFLICT_PATHS = 16;

export type RepositoryReplicaDivergenceReason =
  "no_common_history" | "conflicting_paths" | "merge_unavailable";

/** The open divergence a receipt projects until a later cycle records its reconciliation. */
export interface RepositoryReplicaOpenDivergence {
  divergenceId: string;
  replicaId: string;
  localSnapshotHash: string;
  peerSnapshotHash: string;
  commonSnapshotHash: string | null;
  reason: RepositoryReplicaDivergenceReason;
  conflictPathCount: number;
  /** At most 16 repository-relative paths; local receipts only, never canonical events. */
  conflictPaths: string[];
  openedAt: string;
}

/** ADR-0456 divergence identity: one hash over both sides' exact snapshot hashes. */
export function calculateRepositoryReplicaDivergenceId(
  localSnapshotHash: string,
  peerSnapshotHash: string,
): string {
  if (!SNAPSHOT_HASH.test(localSnapshotHash) || !SNAPSHOT_HASH.test(peerSnapshotHash)) {
    throw new Error("A repository replica divergence requires two exact snapshot hashes.");
  }
  return `sha256:${createHash("sha256")
    .update(`lervo-repository-replica-divergence-v1\n${localSnapshotHash}\n${peerSnapshotHash}\n`)
    .digest("hex")}`;
}

export function isRepositoryReplicaOpenDivergence(
  value: unknown,
): value is RepositoryReplicaOpenDivergence {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as Partial<RepositoryReplicaOpenDivergence>;
  return (
    typeof item.divergenceId === "string" &&
    typeof item.replicaId === "string" &&
    REPLICA_ID.test(item.replicaId) &&
    typeof item.localSnapshotHash === "string" &&
    typeof item.peerSnapshotHash === "string" &&
    SNAPSHOT_HASH.test(item.localSnapshotHash) &&
    SNAPSHOT_HASH.test(item.peerSnapshotHash) &&
    item.divergenceId ===
      calculateRepositoryReplicaDivergenceId(item.localSnapshotHash, item.peerSnapshotHash) &&
    (item.commonSnapshotHash === null ||
      (typeof item.commonSnapshotHash === "string" &&
        SNAPSHOT_HASH.test(item.commonSnapshotHash))) &&
    (item.reason === "no_common_history" ||
      item.reason === "conflicting_paths" ||
      item.reason === "merge_unavailable") &&
    Number.isSafeInteger(item.conflictPathCount) &&
    item.conflictPathCount! >= 0 &&
    Array.isArray(item.conflictPaths) &&
    item.conflictPaths.length <= Math.min(MAXIMUM_CONFLICT_PATHS, item.conflictPathCount!) &&
    item.conflictPaths.every(
      (path) => typeof path === "string" && path.length > 0 && path.length <= 4_096,
    ) &&
    typeof item.openedAt === "string" &&
    Number.isFinite(Date.parse(item.openedAt))
  );
}

/**
 * Reads the open divergence a replica receipt projects. An absent field means none is open; a
 * malformed one fails closed because a silently dropped divergence would read as parity.
 */
export function readRepositoryReplicaOpenDivergence(
  receipt: unknown,
): RepositoryReplicaOpenDivergence | null {
  if (receipt === null || typeof receipt !== "object" || Array.isArray(receipt)) {
    throw new Error("The repository replica receipt is invalid.");
  }
  const value = (receipt as { openDivergence?: unknown }).openDivergence;
  if (value === undefined || value === null) return null;
  if (!isRepositoryReplicaOpenDivergence(value)) {
    throw new Error("The repository replica receipt divergence is invalid.");
  }
  return structuredClone(value);
}
