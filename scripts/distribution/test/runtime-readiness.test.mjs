import assert from "node:assert/strict";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterAll, describe, it } from "vitest";

import { checkRuntimeReadiness, RuntimeReadinessError } from "../check-runtime-readiness.mjs";

const roots = [];
afterAll(async () =>
  Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))),
);

async function ownerSnapshot(value) {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-readiness-test-"));
  roots.push(root);
  const path = resolve(root, "node-runtime-health.json");
  await writeFile(path, JSON.stringify(value), { mode: 0o600 });
  await chmod(path, 0o600);
  return path;
}

function nodeSnapshot(overrides = {}) {
  return {
    schemaVersion: 1,
    status: "ready",
    processId: 1234,
    startedAt: "2026-08-22T00:00:00.000Z",
    updatedAt: "2026-08-22T00:00:01.000Z",
    sync: { status: "ready" },
    remoteControl: { status: "disabled" },
    ...overrides,
  };
}

function currentNodeSnapshot(overrides = {}) {
  return nodeSnapshot({
    eventReader: {
      schemaVersion: 1,
      capability: "event_reader",
      readableEventSchemaVersions: [1, 2],
    },
    eventReaderIdentity: {
      projectId: "prj_readiness_current",
      repositoryIdentityHash: `sha256:${"8".repeat(64)}`,
      destinationId: "hub:wsl-primary",
    },
    workstreamReplication: { status: "ready" },
    workspaceCoordination: { status: "disabled" },
    conversation: { status: "ready" },
    ...overrides,
  });
}

describe("runtime readiness preflight", () => {
  it("accepts a ready live Node snapshot and rejects a stale process", async () => {
    const path = await ownerSnapshot(nodeSnapshot());
    assert.deepEqual(
      await checkRuntimeReadiness(["--runtime", "node", "--snapshot", path], {
        processProbe: () => undefined,
      }),
      { runtime: "node", status: "ready" },
    );
    assert.deepEqual(
      await checkRuntimeReadiness(["--runtime", "node", "--snapshot", path], {
        processProbe: () => {
          throw new Error("missing");
        },
      }),
      {
        runtime: "node",
        status: "not_ready",
        failureCode: "process_unavailable",
      },
    );
  });

  it("accepts the current additive Node snapshot contract", async () => {
    for (const supervision of [
      { status: "ready" },
      { status: "dormant", reasonCode: "workstream_inactive" },
      {
        status: "attention",
        reasonCode: "goal_budget_insufficient",
        resourceBudget: {
          schemaVersion: 1,
          scope: "goal",
          limitTokens: 1_000,
          observedTokens: 800,
          reservedTokens: 100,
          requestedTokens: 200,
          remainingTokens: 100,
        },
      },
    ]) {
      const path = await ownerSnapshot(
        currentNodeSnapshot({
          supervision,
          presenceToken: "0123456789ab-b0123456789ab-4242-0123456789abcdef-0123456789ab",
        }),
      );
      assert.deepEqual(
        await checkRuntimeReadiness(["--runtime", "node", "--snapshot", path], {
          processProbe: () => undefined,
        }),
        { runtime: "node", status: "ready" },
      );
    }
  });

  it("rejects partial, unknown, and internally inconsistent current snapshots", async () => {
    for (const value of [
      nodeSnapshot({ workstreamReplication: { status: "ready" } }),
      currentNodeSnapshot({ unexpected: true }),
      currentNodeSnapshot({ presenceToken: "Not A Token" }),
      currentNodeSnapshot({ sync: { status: "unavailable", failureCode: "hub_unavailable" } }),
      currentNodeSnapshot({ supervision: { status: "dormant", reasonCode: "wrong_reason" } }),
      currentNodeSnapshot({
        supervision: {
          status: "unavailable",
          failureCode: "supervision_attention_required",
          reasonCodes: ["not bounded"],
        },
      }),
      currentNodeSnapshot({
        eventReader: {
          schemaVersion: 1,
          capability: "event_reader",
          readableEventSchemaVersions: [2, 1],
        },
      }),
    ]) {
      const path = await ownerSnapshot(value);
      await assert.rejects(
        checkRuntimeReadiness(["--runtime", "node", "--snapshot", path], {
          processProbe: () => undefined,
        }),
        (error) =>
          error instanceof RuntimeReadinessError && error.code === "invalid_health_snapshot",
      );
    }
  });

  it("reports starting and degraded Node states without copying component details", async () => {
    const path = await ownerSnapshot(
      nodeSnapshot({
        status: "degraded",
        sync: { status: "unavailable", failureCode: "hub_unavailable" },
      }),
    );
    assert.deepEqual(
      await checkRuntimeReadiness(["--runtime", "node", "--snapshot", path], {
        processProbe: () => undefined,
      }),
      {
        runtime: "node",
        status: "not_ready",
        failureCode: "runtime_degraded",
      },
    );
  });

  it("requires an owner-only regular Node snapshot", async () => {
    const path = await ownerSnapshot(nodeSnapshot());
    await chmod(path, 0o644);
    await assert.rejects(
      checkRuntimeReadiness(["--runtime", "node", "--snapshot", path]),
      (error) => error instanceof RuntimeReadinessError && error.code === "unsafe_health_input",
    );
  });

  it("verifies the Hub identity and fixed readiness response", async () => {
    const identity = `sha256:${"7".repeat(64)}`;
    const args = ["--runtime", "hub", "--url", "https://hub.example/", "--hub-identity", identity];
    assert.deepEqual(
      await checkRuntimeReadiness(args, {
        hubRequest: async () => ({
          statusCode: 200,
          identity,
          body: JSON.stringify({ schemaVersion: 1, status: "ready" }),
        }),
      }),
      { runtime: "hub", status: "ready" },
    );
    assert.deepEqual(
      await checkRuntimeReadiness(args, {
        hubRequest: async () => ({
          statusCode: 200,
          identity: `sha256:${"6".repeat(64)}`,
          body: JSON.stringify({ schemaVersion: 1, status: "ready" }),
        }),
      }),
      { runtime: "hub", status: "not_ready", failureCode: "peer_identity_mismatch" },
    );
  });
});
