import { describe, expect, it } from "vitest";

import {
  calculateRepositoryReplicaDivergenceId,
  readRepositoryReplicaOpenDivergence,
} from "../src/index.js";

const local = `sha256:${"a".repeat(64)}`;
const peer = `sha256:${"b".repeat(64)}`;

describe("repository replica divergence identity", () => {
  it("derives one stable identity from both exact snapshot hashes", () => {
    const identity = calculateRepositoryReplicaDivergenceId(local, peer);
    expect(identity).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(calculateRepositoryReplicaDivergenceId(local, peer)).toBe(identity);
    expect(calculateRepositoryReplicaDivergenceId(peer, local)).not.toBe(identity);
    expect(() => calculateRepositoryReplicaDivergenceId("main", peer)).toThrow();
  });

  it("reads an open divergence from a receipt and fails closed on a malformed one", () => {
    const openDivergence = {
      divergenceId: calculateRepositoryReplicaDivergenceId(local, peer),
      replicaId: "project",
      localSnapshotHash: local,
      peerSnapshotHash: peer,
      commonSnapshotHash: null,
      reason: "conflicting_paths",
      conflictPathCount: 1,
      conflictPaths: ["source.ts"],
      openedAt: "2026-10-05T00:00:00.000Z",
    };
    expect(readRepositoryReplicaOpenDivergence({ schemaVersion: 1 })).toBeNull();
    expect(readRepositoryReplicaOpenDivergence({ openDivergence })).toEqual(openDivergence);
    expect(() =>
      readRepositoryReplicaOpenDivergence({
        openDivergence: { ...openDivergence, divergenceId: `sha256:${"c".repeat(64)}` },
      }),
    ).toThrow();
    expect(() => readRepositoryReplicaOpenDivergence([])).toThrow();
  });
});
