import { lstat, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { probeProcessPresence } from "@lervo/project-storage";
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
  it("records the presence it holds, which ends when the publisher closes (ADR-0611)", async () => {
    // A short directory keeps the socket path within the local socket bound.
    const presenceRoot = await mkdtemp("/tmp/lervo-np-");
    roots.push(presenceRoot);
    const previous = process.env.LERVO_USER_STATE_DIRECTORY;
    process.env.LERVO_USER_STATE_DIRECTORY = presenceRoot;
    try {
      const publisher = createNodeRuntimeHealthPublisher(await stateDirectory(), false);
      await publisher.initialize();
      const token = (await snapshot(publisher.path)).presenceToken;
      expect(token).toMatch(/^[a-z0-9-]+$/u);
      expect(readNodeRuntimeHealthSnapshot(await snapshot(publisher.path)).presenceToken).toBe(
        token,
      );
      await expect(probeProcessPresence(token!)).resolves.toBe("alive");
      publisher.close();
      await expect.poll(() => probeProcessPresence(token!), { timeout: 5_000 }).toBe("gone");
    } finally {
      if (previous === undefined) delete process.env.LERVO_USER_STATE_DIRECTORY;
      else process.env.LERVO_USER_STATE_DIRECTORY = previous;
    }
  });

  it("records no token when no presence is held, and still starts", async () => {
    const publisher = createNodeRuntimeHealthPublisher(
      await stateDirectory(),
      false,
      false,
      undefined,
      false,
      false,
      { holdPresence: () => null },
    );
    await publisher.initialize();
    expect((await snapshot(publisher.path)).presenceToken).toBeUndefined();
    publisher.close();
  });

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

  it("resumes the starting heartbeat after a component was briefly unavailable", async () => {
    const publisher = createNodeRuntimeHealthPublisher(
      await stateDirectory(),
      false,
      false,
      undefined,
      false,
      false,
      { startingHeartbeatMs: 20 },
    );
    await publisher.initialize();
    await publisher.observeWorkstreamReplicationFailure("local_state_invalid");
    expect((await snapshot(publisher.path)).status).toBe("degraded");
    // Replication recovers while synchronization is still pending: the Node is starting again.
    await publisher.observeWorkstreamReplication(absentWorkstream);
    const starting = await snapshot(publisher.path);
    expect(starting.status).toBe("starting");
    let heartbeat = starting;
    for (
      let attempt = 0;
      attempt < 200 && heartbeat.updatedAt === starting.updatedAt;
      attempt += 1
    ) {
      await new Promise<void>((resolvePromise) => setTimeout(resolvePromise, 10));
      heartbeat = await snapshot(publisher.path);
    }
    expect(Date.parse(heartbeat.updatedAt)).toBeGreaterThan(Date.parse(starting.updatedAt));
    publisher.close();
    // A closed publisher never starts it again, even when a later change still reads `starting`.
    await publisher.observeWorkstreamReplication(absentWorkstream);
    await new Promise<void>((resolvePromise) => setTimeout(resolvePromise, 1_100));
    await publisher.observeWorkstreamReplication(absentWorkstream);
    const closed = (await snapshot(publisher.path)).updatedAt;
    // Longer than the one-second window in which identical bytes are not written again.
    await new Promise<void>((resolvePromise) => setTimeout(resolvePromise, 1_300));
    expect((await snapshot(publisher.path)).updatedAt).toBe(closed);
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
        readableEventSchemaVersions: [1, 2, 3, 4, 5, 6, 7, 8],
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

it("reports supervision and workstream Lervo debt with its first observation, without degrading", async () => {
  let now = new Date("2026-11-02T00:00:00.000Z");
  const publisher = createNodeRuntimeHealthPublisher(
    await stateDirectory(),
    false,
    false,
    undefined,
    false,
    true,
    { now: () => now },
  );
  await publisher.initialize();
  await publisher.observeSync(idleSync);
  await publisher.observeWorkstreamReplication({
    status: "divergent",
    publishedCount: 0,
    imported: false,
    headCount: 2,
  } as never);
  await publisher.observeSupervision({
    status: "lervo_debt",
    reasonCode: "principal_scope_exceeded",
  });
  now = new Date("2026-11-02T01:00:00.000Z");
  await publisher.observeSupervision({
    status: "lervo_debt",
    reasonCode: "principal_scope_exceeded",
  });
  // ADR-0561: held work is Lervo debt; the Node stays ready and keeps when the debt began.
  expect(readNodeRuntimeHealthSnapshot(await snapshot(publisher.path))).toMatchObject({
    status: "ready",
    workstreamReplication: {
      status: "lervo_debt",
      reasonCode: "divergent_heads",
      since: "2026-11-02T00:00:00.000Z",
    },
    supervision: {
      status: "lervo_debt",
      reasonCode: "principal_scope_exceeded",
      since: "2026-11-02T00:00:00.000Z",
    },
  });
  await publisher.observeSupervision({
    status: "lervo_debt",
    reasonCode: "principal_mandate_expired",
  });
  expect((await snapshot(publisher.path)).supervision).toMatchObject({
    reasonCode: "principal_mandate_expired",
    since: "2026-11-02T01:00:00.000Z",
  });
});
