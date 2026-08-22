import { generateKeyPairSync } from "node:crypto";
import { utimes } from "node:fs/promises";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { OwnerOnlyFileSystemCas } from "@lervo/cas";
import { authorHubCommand, cleanupHubCommandArtifacts } from "@lervo/hub-command";
import { Ed25519RemoteCommandSigner } from "@lervo/remote-command";
import { calculateProjectIdentityHash } from "@lervo/sync-contract";
import { afterEach, describe, expect, it } from "vitest";

import { HubSyncSQLiteStore } from "../src/index.js";
import { databasePath, manifest, registerStore, removeTemporaryRoots } from "./fixture.js";

afterEach(removeTemporaryRoots);

function objectPath(root: string, uri: string): string {
  const hash = uri.slice("lervo-cas://sha256/".length);
  return resolve(root, "sha256", hash.slice(0, 2), hash.slice(2));
}

describe("Hub command artifact lifecycle", () => {
  it("waits for every shared reference, purges idempotently, and permits recreation", async () => {
    const path = await databasePath();
    const project = manifest("prj_artifact_lifecycle_01");
    const target = {
      projectId: project.projectId,
      projectIdentityHash: calculateProjectIdentityHash(project),
    };
    let store = await HubSyncSQLiteStore.open({ path });
    await registerStore(store, project);
    const artifacts = await OwnerOnlyFileSystemCas.open(`${path}.command-cas`);
    const signer = new Ed25519RemoteCommandSigner(
      "key_artifact_lifecycle_01",
      generateKeyPairSync("ed25519").privateKey,
    );
    let nonce = 1;
    const common = {
      store,
      artifacts,
      signer,
      destinationId: "hub:primary",
      target,
      principalId: "operator:artifact-lifecycle",
      authoredAt: "2026-08-22T00:00:00.000Z",
      nonce: () => Buffer.alloc(32, nonce++).toString("base64url"),
    };
    const request = {
      idempotencyKey: "idk_artifact_life_01",
      lifetimeMs: 1_000,
      roleId: "developer",
      provider: "codex",
      risk: "low" as const,
      verificationSuiteIds: ["repo.check"],
      request: "공유 artifact 수명주기 테스트",
    };
    const first = await authorHubCommand({ ...common, request, artifactRetentionMs: 2_000 });
    const second = await authorHubCommand({
      ...common,
      request: { ...request, idempotencyKey: "idk_artifact_life_02" },
      artifactRetentionMs: 3_000,
    });
    expect(second.record.artifactUri).toBe(first.record.artifactUri);

    await expect(store.claimExpiredArtifacts({
      workerId: "gc:test",
      claimedAt: "2026-08-22T00:00:02.500Z",
      leaseDurationMs: 60_000,
      limit: 10,
    })).resolves.toEqual([]);
    const [claim] = await store.claimExpiredArtifacts({
      workerId: "gc:test",
      claimedAt: "2026-08-22T00:00:03.000Z",
      leaseDurationMs: 60_000,
      limit: 10,
    });
    expect(claim).toMatchObject({
      kind: "expired",
      artifactUri: first.record.artifactUri,
    });
    expect(claim!.deliveryIds.sort()).toEqual(
      [first.record.deliveryId, second.record.deliveryId].sort(),
    );
    await expect(artifacts.deleteObject(claim!.artifactUri)).resolves.toEqual({ deleted: true });
    await store.close();
    store = await HubSyncSQLiteStore.open({ path });
    const completion = await store.completeArtifactPurge({
      claimId: claim!.claimId,
      workerId: claim!.workerId,
      completedAt: "2026-08-22T00:00:03.100Z",
    });
    expect(completion).toEqual({
      status: "completed",
      kind: "expired",
      purgedDeliveryCount: 2,
    });
    await expect(store.completeArtifactPurge({
      claimId: claim!.claimId,
      workerId: claim!.workerId,
      completedAt: "2026-08-22T00:00:03.200Z",
    })).resolves.toEqual({ ...completion, status: "duplicate" });
    await expect(artifacts.has(first.record.artifactUri)).resolves.toBe(false);

    const expiredRetry = await authorHubCommand({ ...common, store, request });
    expect(expiredRetry).toMatchObject({
      status: "duplicate",
      record: { artifactLifecycleStatus: "purged" },
    });
    await expect(artifacts.has(first.record.artifactUri)).resolves.toBe(false);

    const recreated = await authorHubCommand({
      ...common,
      store,
      authoredAt: "2026-08-22T00:00:04.000Z",
      request: { ...request, idempotencyKey: "idk_artifact_life_03" },
    });
    expect(recreated.record.artifactUri).toBe(first.record.artifactUri);
    await expect(artifacts.has(recreated.record.artifactUri)).resolves.toBe(true);
    await expect(store.auditIntegrity()).resolves.toMatchObject({ valid: true });
    await store.close();
    const tampered = new DatabaseSync(path);
    tampered.exec("DROP TRIGGER hub_remote_command_artifact_retentions_no_update;");
    tampered.prepare(`
      UPDATE hub_remote_command_artifact_retentions SET artifact_uri = ?
      WHERE delivery_id = ?
    `).run(`lervo-cas://sha256/${"f".repeat(64)}`, recreated.record.deliveryId);
    tampered.exec(`
      CREATE TRIGGER hub_remote_command_artifact_retentions_no_update
        BEFORE UPDATE ON hub_remote_command_artifact_retentions
        BEGIN SELECT RAISE(ABORT, 'hub remote command artifact retentions are append-only'); END;
    `);
    tampered.close();
    const corrupted = await HubSyncSQLiteStore.open({ path });
    await expect(corrupted.auditIntegrity()).rejects.toMatchObject({
      code: "artifact_integrity_failed",
    });
    await corrupted.close();
  });

  it("removes old orphans and blocks authorship while an orphan claim is active", async () => {
    const path = await databasePath();
    const project = manifest("prj_artifact_lifecycle_02");
    const target = {
      projectId: project.projectId,
      projectIdentityHash: calculateProjectIdentityHash(project),
    };
    const store = await HubSyncSQLiteStore.open({ path });
    await registerStore(store, project);
    const artifacts = await OwnerOnlyFileSystemCas.open(`${path}.command-cas`);
    const old = new Date("2026-08-20T00:00:00.000Z");
    const orphan = await artifacts.put(new TextEncoder().encode("끊긴 작성의 orphan"));
    await utimes(objectPath(artifacts.root, orphan.uri), old, old);

    const failingArtifacts = {
      put: artifacts.put.bind(artifacts),
      get: artifacts.get.bind(artifacts),
      listObjects: artifacts.listObjects.bind(artifacts),
      async deleteObject() { throw new Error("fixture delete failed"); },
    };
    await expect(cleanupHubCommandArtifacts({
      repository: store,
      artifacts: failingArtifacts,
      workerId: "gc:test",
      cleanedAt: "2026-08-22T00:00:00.000Z",
      orphanGraceMs: 24 * 60 * 60_000,
      limit: 10,
    })).resolves.toMatchObject({ claimedCount: 1, deletedCount: 0, failureCount: 1 });
    await expect(artifacts.has(orphan.uri)).resolves.toBe(true);

    await expect(cleanupHubCommandArtifacts({
      repository: store,
      artifacts,
      workerId: "gc:test",
      cleanedAt: "2026-08-22T00:00:00.000Z",
      orphanGraceMs: 24 * 60 * 60_000,
      limit: 10,
    })).resolves.toMatchObject({
      claimedCount: 1,
      deletedCount: 1,
      orphanPurgedCount: 1,
      failureCount: 0,
    });
    await expect(artifacts.has(orphan.uri)).resolves.toBe(false);

    const raced = await artifacts.put(new TextEncoder().encode("정리와 작성 경합"));
    await utimes(objectPath(artifacts.root, raced.uri), old, old);
    const claim = await store.claimOrphanArtifact({
      workerId: "gc:test",
      artifactUri: raced.uri,
      observedModifiedAt: old.toISOString(),
      claimedAt: "2026-08-22T00:00:00.000Z",
      leaseDurationMs: 60_000,
    });
    expect(claim).not.toBeNull();
    const signer = new Ed25519RemoteCommandSigner(
      "key_artifact_lifecycle_02",
      generateKeyPairSync("ed25519").privateKey,
    );
    const authoring = {
      store,
      artifacts,
      signer,
      destinationId: "hub:primary",
      target,
      principalId: "operator:artifact-lifecycle",
      authoredAt: "2026-08-22T00:00:00.000Z",
      nonce: () => Buffer.alloc(32, 8).toString("base64url"),
      request: {
        idempotencyKey: "idk_artifact_race_01",
        lifetimeMs: 1_000,
        roleId: "developer",
        provider: "codex",
        risk: "low" as const,
        verificationSuiteIds: ["repo.check"],
        request: "정리와 작성 경합",
      },
    };
    await expect(authorHubCommand(authoring)).rejects.toMatchObject({
      code: "artifact_cleanup_conflict",
    });
    await store.releaseArtifactPurgeClaim({
      claimId: claim!.claimId,
      workerId: claim!.workerId,
      releasedAt: "2026-08-22T00:00:00.500Z",
    });
    await expect(authorHubCommand(authoring)).resolves.toMatchObject({ status: "created" });
    await expect(artifacts.has(raced.uri)).resolves.toBe(true);
    await store.close();
  });
});
