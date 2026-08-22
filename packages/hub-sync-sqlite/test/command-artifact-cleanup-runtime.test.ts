import { DatabaseSync } from "node:sqlite";

import { OwnerOnlyFileSystemCas } from "@lervo/cas";
import { runHubCommandArtifactCleanupLoop } from "@lervo/hub-command";
import { afterEach, describe, expect, it } from "vitest";

import { HubSyncSQLiteStore } from "../src/index.js";
import { databasePath, removeTemporaryRoots } from "./fixture.js";

afterEach(removeTemporaryRoots);

describe("Hub command artifact cleanup runtime", () => {
  it("persists one scheduler lease and inventory cursor across restarts", async () => {
    const path = await databasePath();
    let store = await HubSyncSQLiteStore.open({ path });
    const first = await store.claimArtifactCleanupCycle({
      workerId: "hub:cleanup-a",
      claimedAt: "2026-08-22T00:00:00.000Z",
      leaseDurationMs: 60_000,
    });
    expect(first).toMatchObject({ status: "claimed", inventoryCursor: null });
    await expect(store.claimArtifactCleanupCycle({
      workerId: "hub:cleanup-b",
      claimedAt: "2026-08-22T00:00:01.000Z",
      leaseDurationMs: 60_000,
    })).resolves.toEqual({
      status: "waiting",
      reason: "leased",
      nextAttemptAt: "2026-08-22T00:01:00.000Z",
    });
    await store.close();

    store = await HubSyncSQLiteStore.open({ path });
    const recovered = await store.claimArtifactCleanupCycle({
      workerId: "hub:cleanup-b",
      claimedAt: "2026-08-22T00:01:00.000Z",
      leaseDurationMs: 60_000,
    });
    expect(recovered.status).toBe("claimed");
    await store.failArtifactCleanupCycle({
      workerId: "hub:cleanup-b",
      leaseId: recovered.status === "claimed" ? recovered.leaseId : "unreachable",
      failedAt: "2026-08-22T00:01:00.500Z",
      nextCycleAt: "2026-08-22T00:02:00.500Z",
      failureCode: "artifact_cleanup_cycle_failed",
    });
    await expect(store.claimArtifactCleanupCycle({
      workerId: "hub:cleanup-a",
      claimedAt: "2026-08-22T00:02:00.000Z",
      leaseDurationMs: 60_000,
    })).resolves.toEqual({
      status: "waiting",
      reason: "not_due",
      nextAttemptAt: "2026-08-22T00:02:00.500Z",
    });
    const next = await store.claimArtifactCleanupCycle({
      workerId: "hub:cleanup-a",
      claimedAt: "2026-08-22T00:02:00.500Z",
      leaseDurationMs: 60_000,
    });
    expect(next.status).toBe("claimed");
    const cursor = `lervo-cas://sha256/${"a".repeat(64)}`;
    await expect(store.completeArtifactCleanupCycle({
      workerId: "hub:cleanup-a",
      leaseId: next.status === "claimed" ? next.leaseId : "unreachable",
      completedAt: "2026-08-22T00:02:01.000Z",
      nextCycleAt: "2026-08-22T01:02:01.000Z",
      inventoryCursor: cursor,
      claimedCount: 1,
      deletedCount: 1,
      alreadyMissingCount: 0,
      purgedDeliveryCount: 101,
      orphanPurgedCount: 0,
      failureCount: 0,
      continuationRecommended: true,
    })).rejects.toMatchObject({ code: "invalid_request" });
    await store.completeArtifactCleanupCycle({
      workerId: "hub:cleanup-a",
      leaseId: next.status === "claimed" ? next.leaseId : "unreachable",
      completedAt: "2026-08-22T00:02:01.000Z",
      nextCycleAt: "2026-08-22T01:02:01.000Z",
      inventoryCursor: cursor,
      claimedCount: 1,
      deletedCount: 1,
      alreadyMissingCount: 0,
      purgedDeliveryCount: 0,
      orphanPurgedCount: 1,
      failureCount: 0,
      continuationRecommended: true,
    });
    await store.close();

    store = await HubSyncSQLiteStore.open({ path });
    await expect(store.claimArtifactCleanupCycle({
      workerId: "hub:cleanup-b",
      claimedAt: "2026-08-22T01:02:01.000Z",
      leaseDurationMs: 60_000,
    })).resolves.toMatchObject({ status: "claimed", inventoryCursor: cursor });
    await expect(store.auditIntegrity()).resolves.toMatchObject({ valid: true });
    await store.close();
  });

  it("runs cycles serially, persists safe counts, and stops during the durable wait", async () => {
    const path = await databasePath();
    const store = await HubSyncSQLiteStore.open({ path });
    const artifacts = await OwnerOnlyFileSystemCas.open(`${path}.command-cas`);
    const controller = new AbortController();
    const delays: number[] = [];

    const result = await runHubCommandArtifactCleanupLoop({
      schedule: store,
      repository: store,
      artifacts,
      workerId: "hub:cleanup-loop",
      signal: controller.signal,
      now: () => "2026-08-22T00:00:00.000Z",
      cycleIntervalMs: 60_000,
      wait: {
        wait: async (delayMs) => {
          delays.push(delayMs);
          controller.abort();
        },
      },
    });

    expect(result).toMatchObject({
      status: "stopped",
      claimedCycleCount: 1,
      completedCycleCount: 1,
      failedCycleCount: 0,
      lastCycle: {
        status: "completed",
        result: { claimedCount: 0, continuationRecommended: false },
      },
    });
    expect(delays).toEqual([60_000]);
    const inspection = new DatabaseSync(path, { readOnly: true });
    expect(inspection.prepare(`
      SELECT cycle_count, last_status, last_claimed_count, last_failure_code
      FROM hub_remote_command_artifact_cleanup_runtime
    `).get()).toEqual({
      cycle_count: 1,
      last_status: "completed",
      last_claimed_count: 0,
      last_failure_code: null,
    });
    inspection.close();
    await store.close();
  });

  it("records a fixed failure code without persisting the thrown error", async () => {
    const path = await databasePath();
    const store = await HubSyncSQLiteStore.open({ path });
    const controller = new AbortController();
    const secret = "provider-secret-must-not-be-stored";
    const result = await runHubCommandArtifactCleanupLoop({
      schedule: store,
      repository: store,
      artifacts: {
        async put() { throw new Error("not called"); },
        async get() { throw new Error("not called"); },
        async listObjects() { throw new Error(secret); },
        async deleteObject() { throw new Error("not called"); },
      },
      workerId: "hub:cleanup-failure",
      signal: controller.signal,
      now: () => "2026-08-22T00:00:00.000Z",
      retryDelayMs: 1_000,
      wait: {
        wait: async () => { controller.abort(); },
      },
    });
    expect(result).toMatchObject({
      failedCycleCount: 1,
      lastCycle: {
        status: "failed",
        failureCode: "artifact_cleanup_cycle_failed",
      },
    });
    const inspection = new DatabaseSync(path, { readOnly: true });
    const row = inspection.prepare(
      "SELECT * FROM hub_remote_command_artifact_cleanup_runtime",
    ).get();
    inspection.close();
    expect(row).toMatchObject({
      last_status: "failed",
      last_failure_code: "artifact_cleanup_cycle_failed",
    });
    expect(JSON.stringify(row)).not.toContain(secret);
    await store.close();
  });
});
