import { describe, expect, it } from "vitest";

import {
  calculateRepositoryReplicaSnapshotHash,
  reconcileRepositoryReplicas,
  type RepositoryReplicaSnapshot,
} from "../src/repository-replication.js";

function snapshot(seed: string): RepositoryReplicaSnapshot {
  const source = {
    schemaVersion: 1 as const,
    head: seed.repeat(40).slice(0, 40),
    branch: "main",
    indexTree: seed.repeat(40).slice(0, 40),
    worktreeTree: seed.repeat(40).slice(0, 40),
  };
  return { ...source, snapshotHash: calculateRepositoryReplicaSnapshotHash(source) };
}

describe("repository replica reconciliation", () => {
  it("selects the only side that moved from the exact common snapshot", () => {
    const common = snapshot("1");
    const local = snapshot("2");
    const peer = snapshot("3");
    expect(
      reconcileRepositoryReplicas({
        local,
        peer: common,
        commonSnapshotHash: common.snapshotHash,
      }),
    ).toMatchObject({ status: "push", source: local, expectedPeerHash: common.snapshotHash });
    expect(
      reconcileRepositoryReplicas({
        local: common,
        peer,
        commonSnapshotHash: common.snapshotHash,
      }),
    ).toMatchObject({ status: "pull", source: peer, expectedLocalHash: common.snapshotHash });
  });

  it("is current for equal snapshots and fails closed for two changed sides", () => {
    const common = snapshot("1");
    const local = snapshot("2");
    const peer = snapshot("3");
    expect(
      reconcileRepositoryReplicas({
        local,
        peer: local,
        commonSnapshotHash: common.snapshotHash,
      }),
    ).toEqual({ status: "current", snapshotHash: local.snapshotHash });
    expect(
      reconcileRepositoryReplicas({
        local,
        peer,
        commonSnapshotHash: common.snapshotHash,
      }),
    ).toEqual({
      status: "divergent",
      localHash: local.snapshotHash,
      peerHash: peer.snapshotHash,
      commonHash: common.snapshotHash,
    });
  });
});
