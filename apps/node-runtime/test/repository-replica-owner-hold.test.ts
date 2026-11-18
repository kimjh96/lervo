import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { readRepositoryHold } from "@lervo/repository-knowledge-runtime";
import { afterEach, describe, expect, it } from "vitest";

import { RepositoryReplicaCoordinator } from "../src/repository-replica-coordinator.js";
import { LocalRepositoryReplicaPeer } from "../src/repository-replica-local-peer.js";
import { repositoryReplicaRestoreCommand } from "../src/repository-replica-notice.js";
import { restoreRepositoryReplicaSide } from "../src/repository-replica-restore.js";

const execute = promisify(execFile);
const roots: string[] = [];
const environment = {
  ...process.env,
  GIT_AUTHOR_NAME: "Fixture",
  GIT_AUTHOR_EMAIL: "fixture@example.com",
  GIT_COMMITTER_NAME: "Fixture",
  GIT_COMMITTER_EMAIL: "fixture@example.com",
};
const previousStateDirectory = process.env.LERVO_USER_STATE_DIRECTORY;

async function git(root: string, ...args: string[]): Promise<string> {
  return (await execute("git", ["-C", root, ...args], { env: environment, encoding: "utf8" }))
    .stdout;
}

async function temporary(prefix: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), prefix));
  roots.push(root);
  return root;
}

/** A local repository, its clone as the peer, and a conflict both sides wrote after parity. */
async function conflictingPair() {
  const local = await temporary("lervo-replica-hold-");
  await git(local, "init", "-b", "main");
  await writeFile(join(local, "source.ts"), "const initial = true;\n");
  await writeFile(join(local, ".gitignore"), ".lervo/\n");
  await git(local, "add", ".");
  await git(local, "commit", "-m", "fixture");
  const peer = await temporary("lervo-replica-hold-peer-");
  await rm(peer, { recursive: true, force: true });
  await execute("git", ["clone", "--quiet", local, peer]);
  const state = await temporary("lervo-replica-hold-state-");
  return { local, peer, stateFile: join(state, "replicas.json") };
}

afterEach(async () => {
  if (previousStateDirectory === undefined) delete process.env.LERVO_USER_STATE_DIRECTORY;
  else process.env.LERVO_USER_STATE_DIRECTORY = previousStateDirectory;
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("replica conflicts and the owner's repository hold (ADR-0561)", () => {
  it("keeps a conflict open and changes neither side while the owner holds the repository", async () => {
    const fixture = await conflictingPair();
    const notices: string[] = [];
    const coordinator = new RepositoryReplicaCoordinator({
      stateFile: fixture.stateFile,
      local: new LocalRepositoryReplicaPeer(),
      peer: new LocalRepositoryReplicaPeer(),
      repositoryHeld: async () => true,
      noticeBackup: async ({ backup }) => void notices.push(backup.branch),
    });
    const coordinates = { replicaId: "project", localRoot: fixture.local, peerRoot: fixture.peer };
    await expect(coordinator.reconcile(coordinates)).resolves.toMatchObject({ status: "current" });
    await writeFile(join(fixture.local, "source.ts"), "local\n");
    await writeFile(join(fixture.peer, "source.ts"), "peer\n");
    await expect(coordinator.reconcile(coordinates)).resolves.toMatchObject({
      status: "divergent",
      heldReason: "owner_hold",
    });
    expect(await readFile(join(fixture.local, "source.ts"), "utf8")).toBe("local\n");
    expect(await readFile(join(fixture.peer, "source.ts"), "utf8")).toBe("peer\n");
    expect(notices).toEqual([]);
  }, 30_000);

  it("records the notice before either side changes and holds the conflict when it cannot", async () => {
    const fixture = await conflictingPair();
    const order: string[] = [];
    const coordinator = new RepositoryReplicaCoordinator({
      stateFile: fixture.stateFile,
      local: new LocalRepositoryReplicaPeer(),
      peer: new LocalRepositoryReplicaPeer(),
      repositoryHeld: async () => false,
      noticeBackup: async () => {
        order.push(await readFile(join(fixture.peer, "source.ts"), "utf8"));
        throw new Error("the notice journal is unwritable");
      },
    });
    const coordinates = { replicaId: "project", localRoot: fixture.local, peerRoot: fixture.peer };
    await expect(coordinator.reconcile(coordinates)).resolves.toMatchObject({ status: "current" });
    await writeFile(join(fixture.local, "source.ts"), "local\n");
    await writeFile(join(fixture.peer, "source.ts"), "peer\n");
    await expect(coordinator.reconcile(coordinates)).resolves.toMatchObject({
      status: "divergent",
      heldReason: "notice_unavailable",
    });
    // The notice ran while the peer still held its own side, and nothing changed after it failed.
    expect(order).toEqual(["peer\n"]);
    expect(await readFile(join(fixture.peer, "source.ts"), "utf8")).toBe("peer\n");
    expect(await readFile(join(fixture.local, "source.ts"), "utf8")).toBe("local\n");
  }, 30_000);

  it("saves the losing peer on the peer, and its undo restores it there and holds the repository", async () => {
    const fixture = await conflictingPair();
    process.env.LERVO_USER_STATE_DIRECTORY = await temporary("lervo-replica-hold-user-state-");
    const local = new LocalRepositoryReplicaPeer();
    const peer = new LocalRepositoryReplicaPeer();
    const notices: string[] = [];
    const coordinator = new RepositoryReplicaCoordinator({
      stateFile: fixture.stateFile,
      local,
      peer,
      repositoryHeld: async () => false,
      noticeBackup: async ({ replicaId, backup }) =>
        void notices.push(repositoryReplicaRestoreCommand({ replicaId, backup })),
    });
    const coordinates = { replicaId: "project", localRoot: fixture.local, peerRoot: fixture.peer };
    await expect(coordinator.reconcile(coordinates)).resolves.toMatchObject({ status: "current" });
    await writeFile(join(fixture.local, "source.ts"), "local wins\n");
    await writeFile(join(fixture.peer, "source.ts"), "peer draft\n");
    const result = await coordinator.reconcile(coordinates);
    expect(result).toMatchObject({ backup: { side: "peer" } });
    const branch = "backup" in result ? result.backup!.branch : "";
    expect(notices).toEqual([
      `lervo-node repository-replica restore --config <coordinator-config> --replica project --side peer --branch ${branch}`,
    ]);
    expect(await readFile(join(fixture.peer, "source.ts"), "utf8")).toBe("local wins\n");
    expect(await git(fixture.peer, "show", `${branch}:source.ts`)).toBe("peer draft\n");

    const output: string[] = [];
    await expect(
      restoreRepositoryReplicaSide({
        repository: { replicaId: "project", localRoot: fixture.local, peerRoot: fixture.peer },
        restore: { side: "peer", branch },
        local,
        peer,
        ports: { stdout: (line) => output.push(line), stderr: () => undefined },
        now: () => new Date("2026-11-18T00:00:00Z"),
      }),
    ).resolves.toBe(0);
    expect(await readFile(join(fixture.peer, "source.ts"), "utf8")).toBe("peer draft\n");
    expect(await readRepositoryHold(fixture.local)).toMatchObject({
      reason: `replica project backup ${branch} restored`,
    });
  }, 30_000);
});
