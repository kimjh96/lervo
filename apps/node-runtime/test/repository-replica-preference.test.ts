import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

import {
  RepositoryReplicaCoordinator,
  type RepositoryReplicaPeerPort,
} from "../src/repository-replica-coordinator.js";
import { runRepositoryReplicaCli } from "../src/repository-replica-cli.js";
import { LocalRepositoryReplicaPeer } from "../src/repository-replica-local-peer.js";

const execute = promisify(execFile);
const roots: string[] = [];
const environment = {
  ...process.env,
  GIT_AUTHOR_NAME: "Fixture",
  GIT_AUTHOR_EMAIL: "fixture@example.com",
  GIT_COMMITTER_NAME: "Fixture",
  GIT_COMMITTER_EMAIL: "fixture@example.com",
};

async function git(root: string, ...args: string[]): Promise<string> {
  return (await execute("git", ["-C", root, ...args], { env: environment, encoding: "utf8" }))
    .stdout;
}

async function repository(prefix: string, content: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), prefix));
  roots.push(root);
  await git(root, "init", "-b", "main");
  await writeFile(join(root, "source.ts"), content);
  await writeFile(join(root, ".gitignore"), ".lervo/\n");
  await git(root, "add", ".");
  await git(root, "commit", "-m", "fixture");
  return root;
}

async function clonedPair(): Promise<{ local: string; peer: string; stateFile: string }> {
  const local = await repository("lervo-replica-preference-", "const initial = true;\n");
  const peer = await mkdtemp(join(tmpdir(), "lervo-replica-preference-peer-"));
  await rm(peer, { recursive: true, force: true });
  roots.push(peer);
  await execute("git", ["clone", "--quiet", local, peer]);
  const state = await mkdtemp(join(tmpdir(), "lervo-replica-preference-state-"));
  roots.push(state);
  return { local, peer, stateFile: join(state, "replicas.json") };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("replica conflicts resolve without the owner (ADR-0561)", () => {
  it("prefers the configured peer side after saving the local side, uncommitted bytes included", async () => {
    const fixture = await clonedPair();
    const coordinator = new RepositoryReplicaCoordinator({
      stateFile: fixture.stateFile,
      local: new LocalRepositoryReplicaPeer(),
      peer: new LocalRepositoryReplicaPeer(),
    });
    const coordinates = {
      replicaId: "project",
      localRoot: fixture.local,
      peerRoot: fixture.peer,
      conflictPolicy: "prefer_peer" as const,
    };
    await expect(coordinator.reconcile(coordinates)).resolves.toMatchObject({ status: "current" });
    await writeFile(join(fixture.local, "source.ts"), "local draft\n");
    await writeFile(join(fixture.peer, "source.ts"), "peer wins\n");
    const result = await coordinator.reconcile(coordinates);
    expect(result).toMatchObject({
      reconciled: { strategy: "prefer_peer" },
      backup: { side: "local" },
    });
    expect(await readFile(join(fixture.local, "source.ts"), "utf8")).toBe("peer wins\n");
    expect(await readFile(join(fixture.peer, "source.ts"), "utf8")).toBe("peer wins\n");
    const branch = "backup" in result ? result.backup!.branch : "";
    expect(branch).toMatch(/^lervo\/replica-backup\/project\/[a-f0-9]{12}$/u);
    expect(await git(fixture.local, "show", `${branch}:source.ts`)).toBe("local draft\n");
  }, 30_000);

  it("replaces a peer without common history wholesale only after saving it", async () => {
    const local = await repository("lervo-replica-preference-unrelated-", "local history\n");
    const peer = await repository("lervo-replica-preference-unrelated-peer-", "peer history\n");
    const state = await mkdtemp(join(tmpdir(), "lervo-replica-preference-state-"));
    roots.push(state);
    const coordinator = new RepositoryReplicaCoordinator({
      stateFile: join(state, "replicas.json"),
      local: new LocalRepositoryReplicaPeer(),
      peer: new LocalRepositoryReplicaPeer(),
    });
    const result = await coordinator.reconcile({
      replicaId: "project",
      localRoot: local,
      peerRoot: peer,
    });
    expect(result).toMatchObject({ status: "pushed", backup: { side: "peer" } });
    expect(await readFile(join(peer, "source.ts"), "utf8")).toBe("local history\n");
    const branch = "backup" in result ? result.backup!.branch : "";
    expect(await git(local, "show", `${branch}:source.ts`)).toBe("peer history\n");
  }, 30_000);

  it("changes nothing when the second check sees a side move after the decision", async () => {
    const fixture = await clonedPair();
    const real = new LocalRepositoryReplicaPeer();
    let observations = 0;
    // The peer moves between the decision and the pre-apply check.
    const peer: RepositoryReplicaPeerPort = {
      captureVersion: () => real.captureVersion(),
      bundle: (root, hash) => real.bundle(root, hash),
      apply: (input) => real.apply(input),
      reconcileKnowledgeSupersession: (input) => real.reconcileKnowledgeSupersession(input),
      recordReceipt: (input) => real.recordReceipt(input),
      snapshot: async (root) => {
        observations += 1;
        // The second observation of the conflicting cycle is the pre-apply check.
        if (observations === 2) await writeFile(join(fixture.peer, "source.ts"), "moved\n");
        return real.snapshot(root);
      },
    };
    const coordinator = new RepositoryReplicaCoordinator({
      stateFile: fixture.stateFile,
      local: new LocalRepositoryReplicaPeer(),
      peer,
    });
    const coordinates = { replicaId: "project", localRoot: fixture.local, peerRoot: fixture.peer };
    await expect(coordinator.reconcile(coordinates)).resolves.toMatchObject({ status: "current" });
    await writeFile(join(fixture.local, "source.ts"), "local\n");
    await writeFile(join(fixture.peer, "source.ts"), "peer\n");
    observations = 0;
    await expect(coordinator.reconcile(coordinates)).resolves.toMatchObject({
      status: "divergent",
      heldReason: "stronger_check_disagreement",
    });
    expect(await readFile(join(fixture.local, "source.ts"), "utf8")).toBe("local\n");
    expect(await readFile(join(fixture.peer, "source.ts"), "utf8")).toBe("moved\n");
  }, 30_000);

  it("rejects the removed --prefer option with the backup branch restore path", async () => {
    const errors: string[] = [];
    await expect(
      runRepositoryReplicaCli(
        ["reconcile", "--config", "replicas.json", "--replica", "project", "--prefer", "local"],
        {
          cwd: tmpdir(),
          stdinBytes: async () => new Uint8Array(),
          stdout: () => undefined,
          stdoutBytes: () => undefined,
          stderr: (message) => errors.push(message),
        },
      ),
    ).rejects.toThrow(/--prefer was removed: .*lervo\/replica-backup/u);
  });
});
