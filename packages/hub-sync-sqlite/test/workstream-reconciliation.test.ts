import { createHash } from "node:crypto";
import { canonicalJson } from "@lervo/event-contract";
import { handleWorkstreamPublish, handleWorkstreamRead } from "@lervo/hub-sync";
import type { WorkstreamSnapshot } from "@lervo/schemas";
import { planWorkstreamReconciliation } from "@lervo/sync";
import { afterEach, expect, it } from "vitest";
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

const base: WorkstreamSnapshot = {
  schemaVersion: 1,
  workstreamId: "wks_0123456789abcdef01234567",
  revision: 1,
  status: "active",
  title: "Shared task",
  objective: "Preserve both histories.",
  nextActions: [],
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
  updatedAt: "2026-10-07T00:00:00.000Z",
};
function revision(snapshot: WorkstreamSnapshot, previousSnapshotContentHash: string | null) {
  return {
    snapshot,
    previousSnapshotContentHash,
    snapshotContentHash: `sha256:${createHash("sha256")
      .update(`${canonicalJson(snapshot)}\n`)
      .digest("hex")}`,
  };
}

it("reconciles both active fork heads, retains immutable history, and survives an integrity audit", async () => {
  const path = await databasePath();
  const project = manifest("prj_reconcile_hub_01");
  let store = await HubSyncSQLiteStore.open({ path });
  await registerStore(store, project);
  const registered = registration(project);
  const scope = {
    destinationId,
    projectId: project.projectId,
    repositoryIdentityHash: registered.projectIdentityHash,
  };
  const publish = (value: ReturnType<typeof revision>) =>
    handleWorkstreamPublish({
      store,
      destinationId,
      request: {
        schemaVersion: 1,
        registrationId: registered.registrationId,
        projectId: project.projectId,
        repositoryIdentityHash: registered.projectIdentityHash,
        ...value,
      },
      publishedAt: "2026-10-07T01:00:00.000Z",
    });
  const first = revision(base, null);
  await publish(first);
  const local = revision({ ...base, revision: 2, title: "Local task" }, first.snapshotContentHash);
  const hub = revision({ ...base, revision: 2, title: "Hub task" }, first.snapshotContentHash);
  await publish(hub);
  const remote = await handleWorkstreamRead({ store, ...scope });
  const plan = planWorkstreamReconciliation({
    projectId: project.projectId,
    local,
    remote,
    keep: "local",
    now: base.updatedAt,
  });
  await expect(publish(plan.revision)).rejects.toMatchObject({ code: "unknown_parent" });
  await publish(local);
  const stale = structuredClone(plan.revision);
  stale.snapshot.origin.reconciliationPredecessors![1]!.snapshotContentHash = `sha256:${"f".repeat(64)}`;
  const bad = revision(stale.snapshot, stale.previousSnapshotContentHash);
  await expect(publish(bad)).rejects.toMatchObject({ code: "workstream_conflict" });
  await expect(publish(plan.revision)).resolves.toMatchObject({
    status: "fast_forwarded",
    heads: [{ revision: 1 }],
  });
  await expect(publish(plan.revision)).resolves.toMatchObject({ status: "duplicate" });
  const second = revision(
    { ...plan.revision.snapshot, revision: 2 },
    plan.revision.snapshotContentHash,
  );
  await publish(second);
  await store.close();
  store = await HubSyncSQLiteStore.open({ path });
  await expect(handleWorkstreamRead({ store, ...scope })).resolves.toMatchObject({
    status: "current",
    snapshot: { title: "Local task", revision: 2 },
  });
  // Replaying either old immutable head cannot reopen divergence.
  await expect(publish(local)).resolves.toMatchObject({
    status: "duplicate",
    heads: [{ revision: 2 }],
  });
  await expect(publish(hub)).resolves.toMatchObject({
    status: "duplicate",
    heads: [{ revision: 2 }],
  });
  await store.close();
});

it("rejects reconciliation when either reviewed head has advanced", async () => {
  const project = manifest("prj_reconcile_hub_02");
  const registered = registration(project);
  const store = await HubSyncSQLiteStore.open({ path: await databasePath() });
  await registerStore(store, project);
  const publish = (value: ReturnType<typeof revision>) =>
    handleWorkstreamPublish({
      store,
      destinationId,
      request: {
        schemaVersion: 1,
        registrationId: registered.registrationId,
        projectId: project.projectId,
        repositoryIdentityHash: registered.projectIdentityHash,
        ...value,
      },
      publishedAt: base.updatedAt,
    });
  const first = revision(base, null);
  await publish(first);
  const hub = revision({ ...base, revision: 2, title: "Hub" }, first.snapshotContentHash);
  await publish(hub);
  const local = revision({ ...base, revision: 2, title: "Local" }, first.snapshotContentHash);
  const remote = await handleWorkstreamRead({
    store,
    destinationId,
    projectId: project.projectId,
    repositoryIdentityHash: registered.projectIdentityHash,
  });
  const plan = planWorkstreamReconciliation({
    projectId: project.projectId,
    local,
    remote,
    keep: "hub",
    now: base.updatedAt,
  });
  await publish(local);
  await publish(revision({ ...local.snapshot, revision: 3 }, local.snapshotContentHash));
  await expect(publish(plan.revision)).rejects.toMatchObject({ code: "workstream_conflict" });
  await store.close();
});
