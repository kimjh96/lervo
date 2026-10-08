import { lstat, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  calculateNodeRuntimeReaderIdentityHash,
  createNodeRuntimeHealthPublisher,
  readNodeRuntimeHealthSnapshot,
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
  it("advances updatedAt while starting and settles once when readiness is reached", async () => {
    let settled = 0;
    const publisher = createNodeRuntimeHealthPublisher(
      await stateDirectory(),
      false,
      false,
      undefined,
      false,
      false,
      { startingHeartbeatMs: 20, onSettled: () => (settled += 1) },
    );
    await publisher.initialize();
    const first = await snapshot(publisher.path);
    let heartbeat = first;
    for (let attempt = 0; attempt < 200 && heartbeat.updatedAt === first.updatedAt; attempt += 1) {
      await new Promise<void>((resolvePromise) => setTimeout(resolvePromise, 10));
      heartbeat = await snapshot(publisher.path);
    }
    expect(heartbeat).toMatchObject({ status: "starting", processId: first.processId });
    expect(Date.parse(heartbeat.updatedAt)).toBeGreaterThan(Date.parse(first.updatedAt));
    expect(settled).toBe(0);

    await publisher.observeSync(idleSync);
    await publisher.observeWorkstreamReplication(absentWorkstream);
    const ready = await snapshot(publisher.path);
    expect(ready.status).toBe("ready");
    expect(settled).toBe(1);
    await new Promise<void>((resolvePromise) => setTimeout(resolvePromise, 1_100));
    expect((await snapshot(publisher.path)).updatedAt).toBe(ready.updatedAt);
    await publisher.observeWorkstreamReplicationFailure("local_state_invalid");
    expect(settled).toBe(1);
    publisher.close();
  });

  it("does not replace identical health bytes in one burst but publishes changes immediately", async () => {
    const publisher = createNodeRuntimeHealthPublisher(await stateDirectory(), false);
    await publisher.initialize();
    await publisher.observeSync(idleSync);
    const first = await lstat(publisher.path);
    await publisher.observeSync(idleSync);
    expect((await lstat(publisher.path)).ino).toBe(first.ino);
    await publisher.observeWorkstreamReplicationFailure("local_state_invalid");
    expect((await snapshot(publisher.path)).status).toBe("degraded");
  });

  it("binds advertised reader capability to repository and destination identity", async () => {
    const identity = {
      projectId: "prj_health_identity",
      repositoryIdentityHash: `sha256:${"a".repeat(64)}`,
      destinationId: "hub:health",
    };
    const publisher = createNodeRuntimeHealthPublisher(
      await stateDirectory(),
      false,
      false,
      identity,
    );
    await publisher.initialize();
    const value = await snapshot(publisher.path);

    expect(readNodeRuntimeHealthSnapshot(value)).toMatchObject({ eventReaderIdentity: identity });
    expect(calculateNodeRuntimeReaderIdentityHash(identity)).toMatch(/^sha256:[a-f0-9]{64}$/u);
  });

  it("publishes an owner-only atomic snapshot and reaches ready after sync", async () => {
    const publisher = createNodeRuntimeHealthPublisher(await stateDirectory(), false);
    await publisher.initialize();

    expect(await snapshot(publisher.path)).toMatchObject({
      schemaVersion: 1,
      status: "starting",
      processId: process.pid,
      eventReader: {
        schemaVersion: 1,
        capability: "event_reader",
        readableEventSchemaVersions: [1, 2, 3, 4, 5],
      },
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
      status: "policy_rejected",
      failureCode: "invalid_policy_bundle",
    });
    expect(await snapshot(publisher.path)).toMatchObject({
      status: "degraded",
      remoteControl: { status: "unavailable", failureCode: "invalid_policy_bundle" },
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

  it("reports optional workspace coordination independently", async () => {
    const publisher = createNodeRuntimeHealthPublisher(await stateDirectory(), false, true);
    await publisher.initialize();
    await publisher.observeSync(idleSync);
    await publisher.observeWorkstreamReplication(absentWorkstream);
    expect(await snapshot(publisher.path)).toMatchObject({
      status: "starting",
      workspaceCoordination: { status: "pending" },
    });
    await publisher.observeWorkspaceCoordinationFailure("hub_unavailable");
    expect(await snapshot(publisher.path)).toMatchObject({
      status: "degraded",
      workspaceCoordination: { status: "unavailable", failureCode: "hub_unavailable" },
    });
    await publisher.observeWorkspaceCoordination();
    expect(await snapshot(publisher.path)).toMatchObject({
      status: "ready",
      workspaceCoordination: { status: "ready" },
    });
  });

  it("keeps an enabled conversation pending until Gateway authentication", async () => {
    const publisher = createNodeRuntimeHealthPublisher(
      await stateDirectory(),
      false,
      false,
      undefined,
      true,
    );
    await publisher.initialize();
    await publisher.observeSync(idleSync);
    await publisher.observeWorkstreamReplication(absentWorkstream);
    expect(await snapshot(publisher.path)).toMatchObject({
      status: "starting",
      conversation: { status: "pending" },
    });
    await publisher.observeConversationReady();
    expect(await snapshot(publisher.path)).toMatchObject({
      status: "ready",
      conversation: { status: "ready" },
    });
    await publisher.observeConversationFailure("authentication_failed");
    expect(await snapshot(publisher.path)).toMatchObject({
      status: "degraded",
      conversation: { status: "unavailable", failureCode: "authentication_failed" },
    });
  });
});

it("keeps installed supervision readiness distinct from transport health", async () => {
  const publisher = createNodeRuntimeHealthPublisher(
    await stateDirectory(),
    false,
    false,
    undefined,
    false,
    true,
  );
  await publisher.initialize();
  await publisher.observeSync(idleSync);
  await publisher.observeWorkstreamReplication(absentWorkstream);
  expect((await snapshot(publisher.path)).status).toBe("starting");
  await publisher.observeSupervision({
    status: "unavailable",
    failureCode: "supervision_cycle_failed",
  });
  expect((await snapshot(publisher.path)).status).toBe("degraded");
  await publisher.observeSupervision({ status: "ready" });
  expect(readNodeRuntimeHealthSnapshot(await snapshot(publisher.path)).status).toBe("ready");
});

it("reports an unrelated current workstream as dormant without hiding supervision failure", async () => {
  const publisher = createNodeRuntimeHealthPublisher(
    await stateDirectory(),
    false,
    false,
    undefined,
    false,
    true,
  );
  await publisher.initialize();
  await publisher.observeSync(idleSync);
  await publisher.observeWorkstreamReplication(absentWorkstream);
  expect((await snapshot(publisher.path)).status).toBe("starting");

  await publisher.observeSupervision({ status: "dormant", reasonCode: "workstream_inactive" });
  expect(readNodeRuntimeHealthSnapshot(await snapshot(publisher.path))).toMatchObject({
    status: "ready",
    supervision: { status: "dormant", reasonCode: "workstream_inactive" },
  });
  const dormant = await snapshot(publisher.path);
  await publisher.observeSupervision({ status: "dormant", reasonCode: "local_result_canonical" });
  expect(readNodeRuntimeHealthSnapshot(await snapshot(publisher.path))).toMatchObject({
    status: "ready",
    supervision: { status: "dormant", reasonCode: "local_result_canonical" },
  });
  expect(() =>
    readNodeRuntimeHealthSnapshot({
      ...dormant,
      supervision: { status: "dormant", reasonCode: "unknown" },
    }),
  ).toThrow();
  await publisher.observeSupervision({
    status: "unavailable",
    failureCode: "supervision_cycle_failed",
  });
  expect((await snapshot(publisher.path)).status).toBe("degraded");
});

it("keeps a goal budget attention state operational and validates its exact counters", async () => {
  const publisher = createNodeRuntimeHealthPublisher(
    await stateDirectory(),
    false,
    false,
    undefined,
    false,
    true,
  );
  await publisher.initialize();
  await publisher.observeSync(idleSync);
  await publisher.observeWorkstreamReplication(absentWorkstream);
  const attention = {
    status: "attention" as const,
    reasonCode: "goal_budget_insufficient" as const,
    resourceBudget: {
      schemaVersion: 1 as const,
      scope: "goal" as const,
      limitTokens: 2_000_000,
      observedTokens: 1_925_000,
      reservedTokens: 25_000,
      requestedTokens: 100_000,
      remainingTokens: 50_000,
    },
  };
  await publisher.observeSupervision(attention);
  expect(readNodeRuntimeHealthSnapshot(await snapshot(publisher.path))).toMatchObject({
    status: "ready",
    supervision: attention,
  });
  const invalid = await snapshot(publisher.path);
  expect(() =>
    readNodeRuntimeHealthSnapshot({
      ...invalid,
      supervision: {
        ...attention,
        resourceBudget: { ...attention.resourceBudget, remainingTokens: 50_001 },
      },
    }),
  ).toThrow();
});
