import { DatabaseSync } from "node:sqlite";

import {
  HUB_WORKSPACE_COORDINATION_POLICY_V1,
  hubWorkspaceCoordinationDigest,
  type HubWorkspaceReservationRequest,
  type HubWorkspaceSummary,
} from "@lervo/hub-sync";
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

const hashA = `sha256:${"a".repeat(64)}`;
const hashB = `sha256:${"b".repeat(64)}`;
const commit = "c".repeat(40);

function request(input: {
  projectId: string;
  repositoryIdentityHash: string;
  ordinal: number;
  scopes: Array<{ scopeDigest: string; ancestorDigests: string[] }>;
  requestedAt?: string;
  expiresAt?: string;
  localLeaseExpiresAt?: string;
}): HubWorkspaceReservationRequest {
  const suffix = input.ordinal.toString(16).padStart(24, "0");
  const content = {
    schemaVersion: 1 as const,
    reservationId: `hrs_${suffix}`,
    projectId: input.projectId,
    repositoryIdentityHash: input.repositoryIdentityHash,
    assignmentId: `asn_${suffix}`,
    workspaceId: `wsp_${suffix}`,
    nodeId: "nod_workspace_node_01",
    generation: 1,
    baseCommit: commit,
    integrationTargetDigest: hashA,
    scopes: input.scopes,
    requestedAt: input.requestedAt ?? "2026-08-26T00:00:00.000Z",
    expiresAt: input.expiresAt ?? "2026-08-26T00:05:00.000Z",
    localLeaseExpiresAt: input.localLeaseExpiresAt ?? "2026-08-26T00:10:00.000Z",
    idempotencyKey: `idk_workspace_${suffix}`,
  };
  return { ...content, contentHash: hubWorkspaceCoordinationDigest(content) };
}

function summary(input: {
  projectId: string;
  repositoryIdentityHash: string;
  state: HubWorkspaceSummary["state"];
  updatedAt: string;
  generation?: number;
}): HubWorkspaceSummary {
  const content = {
    schemaVersion: 1 as const,
    projectId: input.projectId,
    repositoryIdentityHash: input.repositoryIdentityHash,
    workspaceId: "wsp_0123456789abcdef01234567",
    assignmentId: "asn_0123456789abcdef01234567",
    nodeId: "nod_workspace_node_01",
    generation: input.generation ?? 1,
    state: input.state,
    hostKind: "orca" as const,
    processObservation: "live" as const,
    terminalCount: 1,
    integrationEvidenceId: null,
    cleanupPlanId: null,
    updatedAt: input.updatedAt,
  };
  return { ...content, contentHash: hubWorkspaceCoordinationDigest(content) };
}

afterEach(removeTemporaryRoots);

describe("Hub workspace coordination SQLite", () => {
  it("grants disjoint reservations, rejects ancestor overlap, and audits no path bytes", async () => {
    const path = await databasePath();
    const project = manifest("prj_workspace_hub_01");
    const identity = registration(project).projectIdentityHash;
    const store = await HubSyncSQLiteStore.open({ path });
    await registerStore(store, project);
    const root = hashA;
    const left = `sha256:${"1".repeat(64)}`;
    const right = `sha256:${"2".repeat(64)}`;
    const first = request({
      projectId: project.projectId,
      repositoryIdentityHash: identity,
      ordinal: 1,
      scopes: [{ scopeDigest: left, ancestorDigests: [root, left] }],
    });
    await expect(
      store.reserveWorkspace({ destinationId, request: first, acceptedAt: first.requestedAt }),
    ).resolves.toMatchObject({ status: "granted", reservation: { state: "granted" } });
    await expect(
      store.reserveWorkspace({ destinationId, request: first, acceptedAt: first.requestedAt }),
    ).resolves.toMatchObject({ status: "duplicate" });
    const disjoint = request({
      projectId: project.projectId,
      repositoryIdentityHash: identity,
      ordinal: 2,
      scopes: [{ scopeDigest: right, ancestorDigests: [root, right] }],
    });
    await expect(
      store.reserveWorkspace({
        destinationId,
        request: disjoint,
        acceptedAt: disjoint.requestedAt,
      }),
    ).resolves.toMatchObject({ status: "granted" });
    const parent = request({
      projectId: project.projectId,
      repositoryIdentityHash: identity,
      ordinal: 3,
      scopes: [{ scopeDigest: root, ancestorDigests: [root] }],
    });
    await expect(
      store.reserveWorkspace({ destinationId, request: parent, acceptedAt: parent.requestedAt }),
    ).resolves.toMatchObject({
      status: "conflict",
      conflictingReservationIds: [first.reservationId, disjoint.reservationId],
    });
    await store.close();

    const database = new DatabaseSync(path, { readOnly: true });
    const audits = database
      .prepare("SELECT event_json FROM hub_workspace_reservation_audit ORDER BY audit_sequence")
      .all() as Array<{ event_json: string }>;
    expect(audits).toHaveLength(4);
    expect(audits.map((row) => JSON.parse(row.event_json))).toMatchObject([
      { previousState: "absent", state: "pending" },
      { previousState: "pending", state: "granted" },
      { previousState: "absent", state: "pending" },
      { previousState: "pending", state: "granted" },
    ]);
    expect(JSON.stringify(audits)).not.toContain("src/");
    database.close();
  });

  it("fences stale renewals, expires old grants, and enforces active capacity without eviction", async () => {
    const project = manifest("prj_workspace_hub_02");
    const identity = registration(project).projectIdentityHash;
    const store = await HubSyncSQLiteStore.open({ path: await databasePath() });
    await registerStore(store, project);
    const granted: string[] = [];
    for (
      let ordinal = 1;
      ordinal <= HUB_WORKSPACE_COORDINATION_POLICY_V1.maxActiveReservations;
      ordinal += 1
    ) {
      const scope = `sha256:${ordinal.toString(16).padStart(64, "0")}`;
      const item = request({
        projectId: project.projectId,
        repositoryIdentityHash: identity,
        ordinal,
        scopes: [{ scopeDigest: scope, ancestorDigests: [scope] }],
      });
      const result = await store.reserveWorkspace({
        destinationId,
        request: item,
        acceptedAt: item.requestedAt,
      });
      expect(result.status).toBe("granted");
      granted.push(item.reservationId);
    }
    const overflow = request({
      projectId: project.projectId,
      repositoryIdentityHash: identity,
      ordinal: 100,
      scopes: [{ scopeDigest: hashB, ancestorDigests: [hashB] }],
    });
    await expect(
      store.reserveWorkspace({
        destinationId,
        request: overflow,
        acceptedAt: overflow.requestedAt,
      }),
    ).resolves.toEqual({
      status: "capacity_rejected",
      policyId: "workspace-coordination-v1",
    });
    const renewalContent = {
      schemaVersion: 1 as const,
      reservationId: granted[0]!,
      projectId: project.projectId,
      repositoryIdentityHash: identity,
      nodeId: "nod_workspace_node_01",
      generation: 2,
      requestedAt: "2026-08-26T00:01:00.000Z",
      expiresAt: "2026-08-26T00:06:00.000Z",
      localLeaseExpiresAt: "2026-08-26T00:10:00.000Z",
    };
    await expect(
      store.renewWorkspaceReservation({
        destinationId,
        request: {
          ...renewalContent,
          contentHash: hubWorkspaceCoordinationDigest(renewalContent),
        },
        acceptedAt: renewalContent.requestedAt,
      }),
    ).rejects.toMatchObject({ code: "workspace_coordination_stale_generation" });

    const afterExpiry = request({
      projectId: project.projectId,
      repositoryIdentityHash: identity,
      ordinal: 101,
      scopes: [{ scopeDigest: hashB, ancestorDigests: [hashB] }],
      requestedAt: "2026-08-26T00:06:00.000Z",
      expiresAt: "2026-08-26T00:11:00.000Z",
      localLeaseExpiresAt: "2026-08-26T00:12:00.000Z",
    });
    await expect(
      store.reserveWorkspace({
        destinationId,
        request: afterExpiry,
        acceptedAt: afterExpiry.requestedAt,
      }),
    ).resolves.toMatchObject({ status: "granted" });
    await store.close();
  });

  it("retains only monotonic observational summaries and prunes them by the v1 policy", async () => {
    const project = manifest("prj_workspace_hub_03");
    const identity = registration(project).projectIdentityHash;
    const store = await HubSyncSQLiteStore.open({ path: await databasePath() });
    await registerStore(store, project);
    const unknownParent = summary({
      projectId: project.projectId,
      repositoryIdentityHash: identity,
      state: "active",
      updatedAt: "2026-08-25T23:59:00.000Z",
    });
    await expect(
      store.publishWorkspaceSummary({
        destinationId,
        summary: unknownParent,
        acceptedAt: unknownParent.updatedAt,
      }),
    ).rejects.toMatchObject({ code: "workspace_coordination_stale_generation" });
    const provisioning = summary({
      projectId: project.projectId,
      repositoryIdentityHash: identity,
      state: "provisioning",
      updatedAt: "2026-08-26T00:00:00.000Z",
    });
    await expect(
      store.publishWorkspaceSummary({
        destinationId,
        summary: provisioning,
        acceptedAt: provisioning.updatedAt,
      }),
    ).resolves.toMatchObject({ status: "created" });
    const ready = summary({
      projectId: project.projectId,
      repositoryIdentityHash: identity,
      state: "ready",
      updatedAt: "2026-08-26T00:01:00.000Z",
    });
    await expect(
      store.publishWorkspaceSummary({
        destinationId,
        summary: ready,
        acceptedAt: ready.updatedAt,
      }),
    ).resolves.toMatchObject({ status: "updated" });
    const active = summary({
      projectId: project.projectId,
      repositoryIdentityHash: identity,
      state: "active",
      updatedAt: "2026-08-26T00:02:00.000Z",
    });
    await expect(
      store.publishWorkspaceSummary({
        destinationId,
        summary: active,
        acceptedAt: active.updatedAt,
      }),
    ).resolves.toMatchObject({ status: "updated", summary: { terminalCount: 1 } });
    const paused = summary({
      projectId: project.projectId,
      repositoryIdentityHash: identity,
      state: "paused",
      updatedAt: "2026-08-26T00:03:00.000Z",
    });
    await expect(
      store.publishWorkspaceSummary({
        destinationId,
        summary: paused,
        acceptedAt: paused.updatedAt,
      }),
    ).resolves.toMatchObject({ status: "updated", summary: { state: "paused" } });
    const resumed = summary({
      projectId: project.projectId,
      repositoryIdentityHash: identity,
      state: "active",
      updatedAt: "2026-08-26T00:04:00.000Z",
    });
    await expect(
      store.publishWorkspaceSummary({
        destinationId,
        summary: resumed,
        acceptedAt: resumed.updatedAt,
      }),
    ).resolves.toMatchObject({ status: "updated", summary: { state: "active" } });
    const stale = summary({
      projectId: project.projectId,
      repositoryIdentityHash: identity,
      state: "removed",
      updatedAt: "2026-08-26T00:05:00.000Z",
    });
    await expect(
      store.publishWorkspaceSummary({ destinationId, summary: stale, acceptedAt: stale.updatedAt }),
    ).rejects.toMatchObject({ code: "workspace_coordination_stale_generation" });
    await expect(
      store.listWorkspaceSummaries({
        destinationId,
        projectId: project.projectId,
        repositoryIdentityHash: identity,
        acceptedAt: "2026-08-27T00:00:00.000Z",
      }),
    ).resolves.toEqual([resumed]);
    await expect(
      store.listWorkspaceSummaries({
        destinationId,
        projectId: project.projectId,
        repositoryIdentityHash: identity,
        acceptedAt: "2026-09-26T00:02:00.000Z",
      }),
    ).resolves.toEqual([]);
    await store.close();
  });
});
