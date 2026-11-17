import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { withNodeRuntimeRetentionLock } from "../src/node-runtime-retention-lock.js";
import {
  REPOSITORY_REPLICA_SERVICE_LOCK_FILE,
  withRepositoryReplicaServiceLock,
} from "../src/repository-replica-service-lock.js";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

async function directory(): Promise<string> {
  const root = await realpath(await mkdtemp(resolve(tmpdir(), "lervo-replica-service-lock-")));
  roots.push(root);
  return root;
}

const birth = (digit: string) => `proc_test_v1:sha256:${digit.repeat(64)}`;
// pid 1 always runs and never belongs to the test, like a pid reused after a WSL restart.
const LIVE_FOREIGN_PID = 1;

describe("repository replica service lock (ADR-0573)", () => {
  it("takes over a lock left by a crashed upgrade whose pid was reused, without waiting", async () => {
    const state = await directory();
    const lock = resolve(state, REPOSITORY_REPLICA_SERVICE_LOCK_FILE);
    await writeFile(lock, `${LIVE_FOREIGN_PID}\n${birth("a")}\n`, { mode: 0o600 });
    await expect(
      withRepositoryReplicaServiceLock(lock, async () => "applied", {
        waitMs: 0,
        observeProcess: (pid) => ({
          status: "present",
          identity: pid === process.pid ? birth("f") : birth("b"),
        }),
      }),
    ).resolves.toBe("applied");
  });

  it("locks the physical state directory when the configured one is a symbolic link", async () => {
    const root = await directory();
    const physical = resolve(root, "state");
    const link = resolve(root, "state-link");
    await mkdir(physical);
    await symlink(physical, link);
    const held = await withRepositoryReplicaServiceLock(
      resolve(link, REPOSITORY_REPLICA_SERVICE_LOCK_FILE),
      async () => readFile(resolve(physical, REPOSITORY_REPLICA_SERVICE_LOCK_FILE), "utf8"),
    );
    expect(held.split("\n", 1)[0]).toBe(String(process.pid));
    // Runtime retention, which deletes inside its root, still refuses a linked root.
    await expect(
      withNodeRuntimeRetentionLock(resolve(link, ".retention.lock"), async () => undefined),
    ).rejects.toThrow("Runtime retention requires a real runtime root.");
  });
});
