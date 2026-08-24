import { lstat, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  createNodeRuntimeHealthPublisher,
  type NodeRuntimeHealthSnapshot,
} from "../src/index.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function stateDirectory(): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-node-health-"));
  roots.push(root);
  const state = resolve(root, ".lervo/state");
  await mkdir(state, { recursive: true });
  return state;
}

async function snapshot(path: string): Promise<NodeRuntimeHealthSnapshot> {
  return JSON.parse(await readFile(path, "utf8")) as NodeRuntimeHealthSnapshot;
}

const idleSync = {
  status: "idle" as const,
  registrationStatus: "unchanged" as const,
  cursor: { seq: 0 as const, eventHash: null },
  enqueuedCount: 0,
  claimedCount: 0 as const,
  acknowledgedCount: 0,
  rescheduledCount: 0,
  acknowledgedBatchCount: 0,
};
const absentWorkstream = {
  status: "absent" as const,
  publishedCount: 0 as const,
  imported: false as const,
  headCount: 0 as const,
};

describe("Node runtime readiness snapshot", () => {
  it("publishes an owner-only atomic snapshot and reaches ready after sync", async () => {
    const publisher = createNodeRuntimeHealthPublisher(await stateDirectory(), false);
    await publisher.initialize();

    expect(await snapshot(publisher.path)).toMatchObject({
      schemaVersion: 1,
      status: "starting",
      processId: process.pid,
      sync: { status: "pending" },
      workstreamReplication: { status: "pending" },
      remoteControl: { status: "disabled" },
    });
    expect((await lstat(publisher.path)).mode & 0o777).toBe(0o600);

    await publisher.observeSync(idleSync);
    await publisher.observeWorkstreamReplication(absentWorkstream);
    expect(await snapshot(publisher.path)).toMatchObject({
      status: "ready",
      sync: { status: "ready" },
    });
    await publisher.stopping();
    expect(await snapshot(publisher.path)).toMatchObject({ status: "stopping" });
  });

  it("keeps remote control pending and reports only fixed failure codes when degraded", async () => {
    const publisher = createNodeRuntimeHealthPublisher(await stateDirectory(), true);
    await publisher.initialize();
    await publisher.observeSync(idleSync);
    await publisher.observeWorkstreamReplication(absentWorkstream);
    expect(await snapshot(publisher.path)).toMatchObject({
      status: "starting",
      remoteControl: { status: "pending" },
    });

    await publisher.observeRemoteControl({
      status: "policy_unavailable",
      policy: { status: "offline", failureCode: "hub_unavailable" },
    });
    expect(await snapshot(publisher.path)).toMatchObject({
      status: "degraded",
      remoteControl: { status: "unavailable", failureCode: "hub_unavailable" },
    });

    await publisher.observeRemoteControl({
      status: "command_checked",
      policy: { status: "unchanged", snapshotId: null },
      command: { status: "idle", leasedCount: 0, acknowledgedCount: 0 },
    });
    expect(await snapshot(publisher.path)).toMatchObject({
      status: "ready",
      remoteControl: { status: "ready" },
    });
  });
});
