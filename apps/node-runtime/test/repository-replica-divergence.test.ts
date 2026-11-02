import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { SQLiteEventStore } from "@lervo/event-store-sqlite";
import type { ProjectStorage } from "@lervo/project-storage";
import { calculateRepositoryReplicaDivergenceId } from "@lervo/sync";
import { afterEach, describe, expect, it } from "vitest";

import {
  RepositoryReplicaCoordinator,
  type RepositoryReplicaCycleResult,
} from "../src/repository-replica-coordinator.js";
import { LocalRepositoryReplicaPeer } from "../src/repository-replica-local-peer.js";
import { RepositoryReplicaCycleReporter } from "../src/repository-replica-cycle-report.js";
import {
  ProjectRepositoryReplicaEvents,
  type RepositoryReplicaEventPort,
} from "../src/repository-replica-events.js";

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

async function repositories(): Promise<{ local: string; peer: string; stateFile: string }> {
  const local = await mkdtemp(join(tmpdir(), "lervo-replica-divergence-"));
  roots.push(local);
  await git(local, "init", "-b", "main");
  await writeFile(join(local, "source.ts"), "const initial = true;\n");
  await writeFile(join(local, ".gitignore"), ".lervo/\n");
  await git(local, "add", ".");
  await git(local, "commit", "-m", "fixture");
  const peer = await mkdtemp(join(tmpdir(), "lervo-replica-divergence-peer-"));
  await rm(peer, { recursive: true, force: true });
  roots.push(peer);
  await execute("git", ["clone", "--quiet", local, peer]);
  const state = await mkdtemp(join(tmpdir(), "lervo-replica-divergence-state-"));
  roots.push(state);
  return { local, peer, stateFile: join(state, "replicas.json") };
}

function recordingEvents() {
  const calls: Array<{ type: string; divergenceId: string; strategy?: string }> = [];
  const port: RepositoryReplicaEventPort = {
    recordDiverged: async (input) => {
      calls.push({ type: "diverged", divergenceId: input.divergence.divergenceId });
      return { status: "recorded" };
    },
    recordReconciled: async (input) => {
      calls.push({
        type: "reconciled",
        divergenceId: input.divergence.divergenceId,
        strategy: input.strategy,
      });
      return { status: "recorded" };
    },
  };
  return { calls, port };
}

async function receipt(root: string): Promise<Record<string, unknown>> {
  return JSON.parse(
    await readFile(join(root, ".lervo/state/repository-replica.json"), "utf8"),
  ) as Record<string, unknown>;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("repository replica divergence surfacing", () => {
  it("records the divergence once, saves the peer side, and reconciles by preferring local", async () => {
    const fixture = await repositories();
    const events = recordingEvents();
    const coordinator = new RepositoryReplicaCoordinator({
      stateFile: fixture.stateFile,
      local: new LocalRepositoryReplicaPeer(),
      peer: new LocalRepositoryReplicaPeer(),
      events: events.port,
      now: () => new Date("2026-10-05T00:00:00.000Z"),
    });
    const hold = { replicaId: "project", localRoot: fixture.local, peerRoot: fixture.peer };
    await expect(coordinator.reconcile(hold)).resolves.toMatchObject({ status: "current" });

    await writeFile(join(fixture.local, "source.ts"), "local\n");
    await writeFile(join(fixture.peer, "source.ts"), "peer\n");
    const [localSnapshot, peerSnapshot] = await Promise.all([
      new LocalRepositoryReplicaPeer().snapshot(fixture.local),
      new LocalRepositoryReplicaPeer().snapshot(fixture.peer),
    ]);
    const divergenceId = calculateRepositoryReplicaDivergenceId(
      localSnapshot.snapshotHash,
      peerSnapshot.snapshotHash,
    );
    // ADR-0561: no owner choice; the cycle that observes the conflict also settles it.
    const result = await coordinator.reconcile(hold);
    expect(result).toMatchObject({
      status: "merged",
      reconciled: { divergenceId, strategy: "prefer_local", event: { status: "recorded" } },
      backup: { side: "peer", snapshotHash: peerSnapshot.snapshotHash },
    });
    expect(await readFile(join(fixture.peer, "source.ts"), "utf8")).toBe("local\n");
    await expect(coordinator.reconcile(hold)).resolves.toMatchObject({ status: "current" });
    expect(events.calls).toEqual([
      { type: "diverged", divergenceId },
      { type: "reconciled", divergenceId, strategy: "prefer_local" },
    ]);
    expect(await receipt(fixture.local)).not.toHaveProperty("openDivergence");
    const state = JSON.parse(await readFile(fixture.stateFile, "utf8")) as {
      divergences?: Record<string, unknown>;
    };
    expect(state.divergences ?? {}).toEqual({});
  }, 30_000);

  it("holds the divergence as Lervo debt when no backup can be saved, then records an external reconciliation", async () => {
    const fixture = await repositories();
    const events = recordingEvents();
    // A local port without a backup cannot make the preference reversible, so nothing changes.
    const local = new LocalRepositoryReplicaPeer();
    const coordinator = new RepositoryReplicaCoordinator({
      stateFile: fixture.stateFile,
      local: {
        captureVersion: () => local.captureVersion(),
        snapshot: (root) => local.snapshot(root),
        bundle: (root, hash) => local.bundle(root, hash),
        apply: (input) => local.apply(input),
        merge: (input) => local.merge(input),
        reconcileKnowledgeSupersession: (input) => local.reconcileKnowledgeSupersession(input),
        recordReceipt: (input) => local.recordReceipt(input),
      },
      peer: new LocalRepositoryReplicaPeer(),
      events: events.port,
    });
    const hold = { replicaId: "project", localRoot: fixture.local, peerRoot: fixture.peer };
    await coordinator.reconcile(hold);
    await writeFile(join(fixture.local, "source.ts"), "local\n");
    await writeFile(join(fixture.peer, "source.ts"), "peer\n");
    const cycles: RepositoryReplicaCycleResult[] = [];
    for (let cycle = 0; cycle < 2; cycle += 1) cycles.push(await coordinator.reconcile(hold));
    expect(cycles[0]).toMatchObject({
      status: "divergent",
      heldReason: "backup_unavailable",
      conflict: { paths: ["source.ts"], pathCount: 1 },
      divergence: { firstObserved: true },
    });
    expect(cycles[1]).toMatchObject({ status: "divergent", divergence: { firstObserved: false } });
    expect(await readFile(join(fixture.local, "source.ts"), "utf8")).toBe("local\n");
    expect(await readFile(join(fixture.peer, "source.ts"), "utf8")).toBe("peer\n");
    expect((await receipt(fixture.local)).openDivergence).toMatchObject({
      reason: "conflicting_paths",
      conflictPaths: ["source.ts"],
    });

    await writeFile(join(fixture.peer, "source.ts"), "local\n");
    await expect(coordinator.reconcile(hold)).resolves.toMatchObject({
      reconciled: { strategy: "external" },
    });
    expect(events.calls.map((call) => call.type)).toEqual(["diverged", "reconciled"]);
  }, 30_000);
});

describe("repository replica event store adapter", () => {
  it("appends schema-valid divergence events once per identity", async () => {
    const root = await mkdtemp(join(tmpdir(), "lervo-replica-events-"));
    roots.push(root);
    const projectId = "prj_replica_events";
    const open = async (): Promise<ProjectStorage> => {
      const events = await SQLiteEventStore.open({
        path: join(root, "events.sqlite"),
        projectId,
        writableEventSchemaVersion: 4,
      });
      return {
        manifest: { projectId } as ProjectStorage["manifest"],
        paths: {} as ProjectStorage["paths"],
        writableEventSchemaVersion: 4,
        events,
        artifacts: {} as ProjectStorage["artifacts"],
        close: async () => events.close(),
      };
    };
    const adapter = new ProjectRepositoryReplicaEvents(open);
    const local = `sha256:${"a".repeat(64)}`;
    const peer = `sha256:${"b".repeat(64)}`;
    const divergence = {
      divergenceId: calculateRepositoryReplicaDivergenceId(local, peer),
      replicaId: "project",
      localSnapshotHash: local,
      peerSnapshotHash: peer,
      commonSnapshotHash: null,
      reason: "conflicting_paths" as const,
      conflictPathCount: 1,
      conflictPaths: ["src/private/path.ts"],
      openedAt: "2026-10-05T00:00:00.000Z",
    };
    const diverged = {
      repositoryRoot: root,
      divergence,
      conflictPolicy: "hold" as const,
      occurredAt: divergence.openedAt,
    };

    await expect(adapter.recordDiverged(diverged)).resolves.toEqual({ status: "recorded" });
    await expect(
      adapter.recordDiverged({ ...diverged, occurredAt: "2026-10-05T00:01:00.000Z" }),
    ).resolves.toEqual({ status: "duplicate" });
    await expect(
      adapter.recordReconciled({
        ...diverged,
        strategy: "merge",
        resultSnapshotHash: `sha256:${"c".repeat(64)}`,
        occurredAt: "2026-10-05T00:02:00.000Z",
      }),
    ).resolves.toEqual({ status: "recorded" });

    const storage = await open();
    try {
      const stored = storage.events.list();
      expect(stored.map((event) => event.type)).toEqual([
        "repository.replica.diverged",
        "repository.replica.reconciled",
      ]);
      expect(JSON.stringify(stored)).not.toContain("src/private/path.ts");
    } finally {
      await storage.close();
    }
    await expect(
      new ProjectRepositoryReplicaEvents(() =>
        Promise.reject(new Error("no project")),
      ).recordDiverged(diverged),
    ).resolves.toEqual({
      status: "unavailable",
      failureCode: "repository_replica_event_unavailable",
    });
  });
});

describe("repository replica cycle reporting", () => {
  const divergent = (firstObserved: boolean): RepositoryReplicaCycleResult => ({
    replicaId: "project",
    status: "divergent",
    localHash: `sha256:${"a".repeat(64)}`,
    peerHash: `sha256:${"b".repeat(64)}`,
    commonHash: null,
    conflict: { reason: "conflicting_paths", paths: ["source.ts"], pathCount: 1 },
    divergence: {
      divergenceId: `sha256:${"d".repeat(64)}`,
      firstObserved,
      event: firstObserved ? { status: "recorded" } : null,
    },
  });

  it("logs a divergence identity once in watch mode and reports degraded health", () => {
    const reporter = new RepositoryReplicaCycleReporter(true);
    expect(reporter.observeResult(divergent(true)).stderr).toHaveLength(1);
    expect(reporter.observeResult(divergent(false)).stderr).toEqual([]);
    expect(reporter.snapshot(new Date(0))).toMatchObject({
      status: "degraded",
      replicas: { project: { status: "divergent" } },
    });
    reporter.observeResult({
      replicaId: "project",
      status: "current",
      snapshotHash: `sha256:${"c".repeat(64)}`,
    });
    expect(reporter.snapshot(new Date(0)).status).toBe("ready");
  });

  it("logs a repeated failure once and then only a counter", () => {
    const reporter = new RepositoryReplicaCycleReporter(true);
    const failure = {
      code: "repository_replica_merge_failed",
      stage: "merge" as const,
      gitExitCode: 128,
      stderrDigest: "fatal: bad object",
      causeChain: ["The repository replica merge could not be applied."],
    };
    const lines = Array.from(
      { length: 12 },
      () => reporter.observeFailure("project", failure, true).stderr,
    ).flat();
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain("stderr: fatal: bad object");
    expect(lines[1]).toContain("repeated 10 times");
    expect(
      reporter.observeResult({
        replicaId: "project",
        status: "current",
        snapshotHash: `sha256:${"c".repeat(64)}`,
      }).stdout,
    ).toEqual(["Repository replica project recovered after 12 failed cycle(s)."]);
  });
});
