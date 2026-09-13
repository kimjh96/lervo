import { createHash } from "node:crypto";

import { canonicalJson } from "@lervo/event-contract";
import { handleWorkstreamPublish, handleWorkstreamRead } from "@lervo/hub-sync";
import type { WorkstreamReplicationPublishRequest, WorkstreamSnapshot } from "@lervo/schemas";
import { afterEach, describe, expect, it } from "vitest";

import { HubSyncSQLiteStore } from "../src/index.js";
import {
  databasePath,
  destinationId,
  manifest,
  registerStore,
  registration,
  removeTemporaryRoots,
} from "./fixture.js";

afterEach(removeTemporaryRoots);

function hash(value: string): string {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

function snapshot(revision: number, title: string): WorkstreamSnapshot {
  return {
    schemaVersion: 1,
    workstreamId: "wks_0123456789abcdef01234567",
    revision,
    status: "active",
    title,
    objective: "Continue the same repository task across authorized nodes.",
    nextActions: ["Run the next bounded implementation step."],
    blockers: [],
    notes: [],
    references: [],
    pendingDecisions: [],
    pendingApprovals: [],
    origin: {
      kind: "created",
      sourceArtifactId: null,
      sourceContentHash: null,
      sourcePathDigest: null,
    },
    updatedAt: `2026-08-24T00:00:0${revision}.000Z`,
  };
}

function publication(
  project: ReturnType<typeof manifest>,
  value: WorkstreamSnapshot,
  previousSnapshotContentHash: string | null,
): WorkstreamReplicationPublishRequest {
  const serialized = `${canonicalJson(value)}\n`;
  const registered = registration(project);
  return {
    schemaVersion: 1,
    registrationId: registered.registrationId,
    projectId: project.projectId,
    repositoryIdentityHash: registered.projectIdentityHash,
    snapshotContentHash: hash(serialized),
    previousSnapshotContentHash,
    snapshot: value,
  };
}

describe("Hub workstream replication SQLite", () => {
  it("persists exact revisions, deduplicates retries, and exposes divergence without selecting a winner", async () => {
    const path = await databasePath();
    const project = manifest("prj_workstream_hub_01");
    let store = await HubSyncSQLiteStore.open({ path });
    await registerStore(store, project);

    const first = publication(project, snapshot(1, "Initial workstream"), null);
    const scope = {
      topic: "workstream" as const,
      projectId: project.projectId,
      repositoryIdentityHash: first.repositoryIdentityHash,
      destinationId,
      signal: new AbortController().signal,
    };
    const before = await store.waitForRuntimeChange({ ...scope, cursor: null });
    const wake = store.waitForRuntimeChange({ ...scope, cursor: before.cursor });

    await expect(
      handleWorkstreamPublish({
        store,
        destinationId,
        request: first,
        publishedAt: "2026-08-24T01:00:00.000Z",
      }),
    ).resolves.toMatchObject({ status: "created", heads: [{ revision: 1 }] });
    expect((await wake).status).toBe("changed");
    await expect(
      handleWorkstreamPublish({
        store,
        destinationId,
        request: first,
        publishedAt: "2026-08-24T01:00:01.000Z",
      }),
    ).resolves.toMatchObject({ status: "duplicate", heads: [{ revision: 1 }] });

    const secondA = publication(
      project,
      snapshot(2, "Node A continuation"),
      first.snapshotContentHash,
    );
    await expect(
      handleWorkstreamPublish({
        store,
        destinationId,
        request: secondA,
        publishedAt: "2026-08-24T01:01:00.000Z",
      }),
    ).resolves.toMatchObject({ status: "fast_forwarded", heads: [{ revision: 2 }] });
    const secondB = publication(
      project,
      snapshot(2, "Node B continuation"),
      first.snapshotContentHash,
    );
    await expect(
      handleWorkstreamPublish({
        store,
        destinationId,
        request: secondB,
        publishedAt: "2026-08-24T01:02:00.000Z",
      }),
    ).resolves.toMatchObject({ status: "divergent", heads: [{ revision: 2 }, { revision: 2 }] });

    await store.close();
    store = await HubSyncSQLiteStore.open({ path });
    await expect(
      handleWorkstreamRead({
        store,
        destinationId,
        projectId: project.projectId,
        repositoryIdentityHash: first.repositoryIdentityHash,
      }),
    ).resolves.toMatchObject({
      status: "divergent",
      snapshot: null,
      heads: [{ revision: 2 }, { revision: 2 }],
    });
    await store.close();
  });

  it("rejects an unknown parent and an unregistered repository identity", async () => {
    const store = await HubSyncSQLiteStore.open({ path: await databasePath() });
    const project = manifest("prj_workstream_hub_02");
    await registerStore(store, project);
    const second = publication(project, snapshot(2, "Missing parent"), `sha256:${"f".repeat(64)}`);
    await expect(
      handleWorkstreamPublish({
        store,
        destinationId,
        request: second,
        publishedAt: "2026-08-24T01:00:00.000Z",
      }),
    ).rejects.toMatchObject({ code: "unknown_parent" });
    await expect(
      handleWorkstreamRead({
        store,
        destinationId,
        projectId: project.projectId,
        repositoryIdentityHash: `sha256:${"e".repeat(64)}`,
      }),
    ).rejects.toMatchObject({ code: "registration_required" });
    await store.close();
  });
});
