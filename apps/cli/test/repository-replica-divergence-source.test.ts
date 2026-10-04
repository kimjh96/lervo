import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { calculateRepositoryReplicaDivergenceId } from "@lervo/sync";
import { afterEach, describe, expect, it } from "vitest";

import { readRepositoryReplicaDivergence } from "../src/repository-replica-divergence-source.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function repository(receipt?: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "lervo-replica-source-"));
  roots.push(root);
  if (receipt !== undefined) {
    await mkdir(join(root, ".lervo/state"), { recursive: true });
    await writeFile(join(root, ".lervo/state/repository-replica.json"), receipt);
  }
  return root;
}

describe("repository replica divergence source", () => {
  it("reads no divergence without replication and the projected one when open", async () => {
    await expect(readRepositoryReplicaDivergence(await repository())).resolves.toEqual({
      status: "observed",
      divergence: null,
    });
    const local = `sha256:${"a".repeat(64)}`;
    const peer = `sha256:${"b".repeat(64)}`;
    const openDivergence = {
      divergenceId: calculateRepositoryReplicaDivergenceId(local, peer),
      replicaId: "project",
      localSnapshotHash: local,
      peerSnapshotHash: peer,
      commonSnapshotHash: null,
      reason: "no_common_history",
      conflictPathCount: 0,
      conflictPaths: [],
      openedAt: "2026-10-05T00:00:00.000Z",
    };
    await expect(
      readRepositoryReplicaDivergence(
        await repository(JSON.stringify({ schemaVersion: 1, status: "attention", openDivergence })),
      ),
    ).resolves.toEqual({ status: "observed", divergence: openDivergence });
  });

  it("reports an unreadable receipt as a lifecycle issue instead of parity", async () => {
    await expect(readRepositoryReplicaDivergence(await repository("{"))).resolves.toMatchObject({
      status: "invalid",
      issue: { code: "repository_replica_receipt_invalid" },
    });
  });
});
