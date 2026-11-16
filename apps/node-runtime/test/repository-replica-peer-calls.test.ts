import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

import {
  RepositoryReplicaCoordinator,
  type RepositoryReplicaPeerPort,
} from "../src/repository-replica-coordinator.js";
import { LocalRepositoryReplicaPeer } from "../src/repository-replica-local-peer.js";

const execute = promisify(execFile);
const roots: string[] = [];

async function git(root: string, ...args: string[]): Promise<void> {
  await execute("git", ["-C", root, ...args], {
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "Fixture",
      GIT_AUTHOR_EMAIL: "fixture@example.com",
      GIT_COMMITTER_NAME: "Fixture",
      GIT_COMMITTER_EMAIL: "fixture@example.com",
    },
  });
}

async function replica(): Promise<{ local: string; peer: string; stateFile: string }> {
  const local = await mkdtemp(join(tmpdir(), "lervo-replica-calls-"));
  roots.push(local);
  await git(local, "init", "-b", "main");
  await writeFile(join(local, "source.ts"), "const initial = true;\n");
  await writeFile(join(local, ".gitignore"), ".lervo/\n");
  await git(local, "add", ".");
  await git(local, "commit", "-m", "fixture");
  const peer = await mkdtemp(join(tmpdir(), "lervo-replica-calls-peer-"));
  await rm(peer, { recursive: true, force: true });
  roots.push(peer);
  await execute("git", ["clone", "--quiet", local, peer]);
  const state = await mkdtemp(join(tmpdir(), "lervo-replica-calls-state-"));
  roots.push(state);
  return { local, peer, stateFile: join(state, "replicas.json") };
}

/** The peer port as the coordinator sees it, recording every request that would cross SSH. */
function countingPeer(): { port: RepositoryReplicaPeerPort; take(): string[] } {
  const target = new LocalRepositoryReplicaPeer();
  let calls: string[] = [];
  const port = new Proxy(target, {
    get(object, property, receiver) {
      const value = Reflect.get(object, property, receiver) as unknown;
      if (typeof value !== "function" || property === "merge") return value;
      return (...args: unknown[]) => {
        calls.push(String(property));
        return (value as (...items: unknown[]) => unknown).apply(object, args);
      };
    },
  });
  return {
    port,
    take: () => {
      const taken = calls;
      calls = [];
      return taken;
    },
  };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("peer requests per replica cycle (ADR-0570)", () => {
  it("asks an unchanged current peer for one snapshot per recovery cycle", async () => {
    const fixture = await replica();
    const peer = countingPeer();
    let clock = Date.parse("2026-11-16T00:00:00.000Z");
    const coordinator = new RepositoryReplicaCoordinator({
      stateFile: fixture.stateFile,
      local: new LocalRepositoryReplicaPeer(),
      peer: peer.port,
      now: () => new Date(clock),
    });
    const cycle = async () => {
      const result = await coordinator.reconcile({
        replicaId: "fixture",
        localRoot: fixture.local,
        peerRoot: fixture.peer,
        trigger: "recovery",
      });
      expect(result.status).toBe("current");
      return peer.take();
    };

    expect(await cycle()).toEqual([
      "snapshot",
      "reconcileKnowledgeSupersession",
      "captureVersion",
      "recordReceipt",
    ]);
    // Before ADR-0570 every such cycle also repeated the supersession exchange.
    clock += 30_000;
    expect(await cycle()).toEqual(["snapshot"]);
    clock += 600_000;
    expect(await cycle()).toEqual(["snapshot"]);
    // A settled exchange is trusted for 15 minutes, as is the proven capture version.
    clock += 300_000;
    expect(await cycle()).toEqual(["snapshot", "reconcileKnowledgeSupersession", "captureVersion"]);
    clock += 30_000;
    expect(await cycle()).toEqual(["snapshot"]);
  });

  it("exchanges supersession again as soon as either side changes", async () => {
    const fixture = await replica();
    const peer = countingPeer();
    const coordinator = new RepositoryReplicaCoordinator({
      stateFile: fixture.stateFile,
      local: new LocalRepositoryReplicaPeer(),
      peer: peer.port,
      now: () => new Date("2026-11-16T00:00:00.000Z"),
    });
    const coordinates = {
      replicaId: "fixture",
      localRoot: fixture.local,
      peerRoot: fixture.peer,
      trigger: "recovery" as const,
    };
    await coordinator.reconcile(coordinates);
    peer.take();

    await writeFile(join(fixture.local, "source.ts"), "const local = true;\n");
    await expect(
      coordinator.reconcile({ ...coordinates, trigger: "change" }),
    ).resolves.toMatchObject({ status: "pushed" });
    expect(peer.take()).toEqual([
      "snapshot",
      "reconcileKnowledgeSupersession",
      "apply",
      "snapshot",
      "recordReceipt",
    ]);
    // The pushed state is a new equal snapshot, so its first recovery cycle exchanges once more
    // and replaces the peer's `pushed` receipt with a `current` one.
    await coordinator.reconcile(coordinates);
    expect(peer.take()).toEqual(["snapshot", "reconcileKnowledgeSupersession", "recordReceipt"]);
    await coordinator.reconcile(coordinates);
    expect(peer.take()).toEqual(["snapshot"]);

    await writeFile(join(fixture.peer, "source.ts"), "const peer = true;\n");
    await expect(coordinator.reconcile(coordinates)).resolves.toMatchObject({ status: "pulled" });
    expect(peer.take()).toEqual([
      "snapshot",
      "reconcileKnowledgeSupersession",
      "bundle",
      "snapshot",
      "recordReceipt",
    ]);
  });
});
