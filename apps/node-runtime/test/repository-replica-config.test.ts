import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { readRepositoryReplicaCoordinatorConfig } from "../src/repository-replica-config.js";

const roots: string[] = [];

async function configWith(extra: Record<string, unknown>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "lervo-replica-config-"));
  roots.push(root);
  const path = join(root, "config.json");
  await writeFile(
    path,
    JSON.stringify({
      schemaVersion: 1,
      stateFile: "state.json",
      pollIntervalMs: 30_000,
      peerWatch: false,
      peer: {
        executable: "ssh",
        arguments: [],
        destination: "fixture",
        remoteNodeExecutable: "node",
        remoteRuntimeExecutable: "runtime",
      },
      repositories: [{ replicaId: "project", localRoot: "/local", peerRoot: "/peer" }],
      ...extra,
    }),
  );
  await chmod(path, 0o600);
  return path;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("repository replica coordinator configuration", () => {
  it("accepts an omitted or bounded idle recovery ceiling", async () => {
    await expect(
      readRepositoryReplicaCoordinatorConfig(await configWith({})),
    ).resolves.not.toHaveProperty("idleRecoveryCeilingMs");
    for (const idleRecoveryCeilingMs of [30_000, 600_000, 3_600_000]) {
      await expect(
        readRepositoryReplicaCoordinatorConfig(await configWith({ idleRecoveryCeilingMs })),
      ).resolves.toMatchObject({ idleRecoveryCeilingMs });
    }
  });

  it("rejects an idle recovery ceiling outside 30 seconds to one hour", async () => {
    for (const idleRecoveryCeilingMs of [29_999, 3_600_001, 60_000.5, "600000"]) {
      await expect(
        readRepositoryReplicaCoordinatorConfig(await configWith({ idleRecoveryCeilingMs })),
      ).rejects.toThrow("The repository replica coordinator configuration is invalid.");
    }
  });
});
