import { createHash } from "node:crypto";

export interface RepositoryReplicaSnapshot {
  schemaVersion: 1;
  head: string;
  branch: string | null;
  indexTree: string;
  worktreeTree: string;
  snapshotHash: string;
}

export type RepositoryReplicaReconciliation =
  | { status: "current"; snapshotHash: string }
  | { status: "push"; source: RepositoryReplicaSnapshot; expectedPeerHash: string }
  | { status: "pull"; source: RepositoryReplicaSnapshot; expectedLocalHash: string }
  | {
      status: "divergent";
      localHash: string;
      peerHash: string;
      commonHash: string | null;
    };

const GIT_OBJECT_ID = /^[a-f0-9]{40,64}$/u;
const SNAPSHOT_HASH = /^sha256:[a-f0-9]{64}$/u;

function canonicalSnapshot(snapshot: Omit<RepositoryReplicaSnapshot, "snapshotHash">): string {
  return `${JSON.stringify({
    schemaVersion: snapshot.schemaVersion,
    head: snapshot.head,
    branch: snapshot.branch,
    indexTree: snapshot.indexTree,
    worktreeTree: snapshot.worktreeTree,
  })}\n`;
}

export function calculateRepositoryReplicaSnapshotHash(
  snapshot: Omit<RepositoryReplicaSnapshot, "snapshotHash">,
): string {
  return `sha256:${createHash("sha256").update(canonicalSnapshot(snapshot)).digest("hex")}`;
}

export function assertRepositoryReplicaSnapshot(snapshot: RepositoryReplicaSnapshot): void {
  if (
    snapshot.schemaVersion !== 1 ||
    !GIT_OBJECT_ID.test(snapshot.head) ||
    (snapshot.branch !== null &&
      (!/^[A-Za-z0-9][A-Za-z0-9._/-]{0,254}$/u.test(snapshot.branch) ||
        snapshot.branch.includes("..") ||
        snapshot.branch.endsWith("/"))) ||
    !GIT_OBJECT_ID.test(snapshot.indexTree) ||
    !GIT_OBJECT_ID.test(snapshot.worktreeTree) ||
    !SNAPSHOT_HASH.test(snapshot.snapshotHash) ||
    snapshot.snapshotHash !== calculateRepositoryReplicaSnapshotHash(snapshot)
  ) {
    throw new Error("The repository replica snapshot is invalid.");
  }
}

export function reconcileRepositoryReplicas(input: {
  local: RepositoryReplicaSnapshot;
  peer: RepositoryReplicaSnapshot;
  commonSnapshotHash: string | null;
}): RepositoryReplicaReconciliation {
  assertRepositoryReplicaSnapshot(input.local);
  assertRepositoryReplicaSnapshot(input.peer);
  if (input.commonSnapshotHash !== null && !SNAPSHOT_HASH.test(input.commonSnapshotHash)) {
    throw new Error("The repository replica common snapshot hash is invalid.");
  }
  if (input.local.snapshotHash === input.peer.snapshotHash) {
    return { status: "current", snapshotHash: input.local.snapshotHash };
  }
  if (input.commonSnapshotHash === input.local.snapshotHash) {
    return {
      status: "pull",
      source: structuredClone(input.peer),
      expectedLocalHash: input.local.snapshotHash,
    };
  }
  if (input.commonSnapshotHash === input.peer.snapshotHash) {
    return {
      status: "push",
      source: structuredClone(input.local),
      expectedPeerHash: input.peer.snapshotHash,
    };
  }
  return {
    status: "divergent",
    localHash: input.local.snapshotHash,
    peerHash: input.peer.snapshotHash,
    commonHash: input.commonSnapshotHash,
  };
}
