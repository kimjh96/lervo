import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

import { LocalRepositoryReplicaPeer } from "../src/repository-replica-coordinator.js";
import { captureRepositoryReplicaSnapshot } from "../src/repository-replica-git.js";
import { awaitRepositoryReplicaReadiness } from "../src/repository-replica-readiness.js";

const execute = promisify(execFile);
const roots: string[] = [];

async function repository(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "lervo-replica-ready-"));
  roots.push(root);
  await execute("git", ["-C", root, "init", "-b", "main"]);
  await writeFile(join(root, ".gitignore"), ".lervo/\n");
  await writeFile(join(root, "source.ts"), "const a =\n");
  await execute("git", ["-C", root, "add", "."]);
  await execute("git", [
    "-C",
    root,
    "-c",
    "user.name=Fixture",
    "-c",
    "user.email=f@x",
    "commit",
    "-m",
    "fixture",
  ]);
  await mkdir(join(root, ".lervo", "state"), { recursive: true });
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("repository replica readiness", () => {
  it("admits only a fresh receipt for the exact current worktree snapshot", async () => {
    const root = await repository();
    const snapshot = await captureRepositoryReplicaSnapshot(root);
    await new LocalRepositoryReplicaPeer().recordReceipt({
      schemaVersion: 1,
      replicaId: "fixture",
      repositoryRoot: root,
      commonSnapshotHash: snapshot.snapshotHash,
      localSnapshotHash: snapshot.snapshotHash,
      peerSnapshotHash: snapshot.snapshotHash,
      reconciledAt: "2026-09-10T09:00:00.000Z",
      status: "current",
    });
    let now = Date.parse("2026-09-10T09:00:01.000Z");
    await expect(
      awaitRepositoryReplicaReadiness({
        repositoryRoot: root,
        maximumStalenessMs: 5_000,
        waitTimeoutMs: 1,
        pollIntervalMs: 1,
        nowMilliseconds: () => now++,
      }),
    ).resolves.toBe(snapshot.snapshotHash);

    await writeFile(join(root, "source.ts"), "const a =");
    await expect(
      awaitRepositoryReplicaReadiness({
        repositoryRoot: root,
        maximumStalenessMs: 5_000,
        waitTimeoutMs: 1,
        pollIntervalMs: 1,
        nowMilliseconds: () => now++,
      }),
    ).rejects.toMatchObject({ code: "repository_replica_not_ready" });
  });
});
