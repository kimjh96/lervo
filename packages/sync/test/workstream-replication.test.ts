import type {
  WorkstreamReplicationPublishRequest,
  WorkstreamSnapshot,
} from "@lervo/schemas";
import { createProjectRegistrationRequest } from "@lervo/sync-contract";
import { describe, expect, it, vi } from "vitest";

import {
  runWorkstreamReplicationCycle,
  type AuthenticatedWorkstreamHubTransport,
  type HubTransportResponse,
  type LocalWorkstreamRevision,
  type WorkstreamReplicationLocalPort,
} from "../src/index.js";
import { destinationId, manifest, peerIdentityHash } from "./fixture.js";

const firstHash = `sha256:${"1".repeat(64)}`;
const secondHash = `sha256:${"2".repeat(64)}`;
const branchHash = `sha256:${"3".repeat(64)}`;

function snapshot(revision: number): WorkstreamSnapshot {
  return {
    schemaVersion: 1,
    workstreamId: "wks_012301230123012301230123",
    revision,
    status: "active",
    title: `Revision ${revision}`,
    objective: "Preserve repository continuation across nodes.",
    nextActions: [],
    blockers: [],
    notes: [],
    references: [],
    pendingDecisions: [],
    pendingApprovals: [],
    origin: { kind: "created", sourceArtifactId: null, sourceContentHash: null, sourcePathDigest: null },
    updatedAt: `2026-08-24T00:00:0${revision}.000Z`,
  };
}

function response(body: unknown): HubTransportResponse {
  return {
    authentication: { status: "verified", destinationId, peerIdentityHash },
    body,
  };
}

function head(value: WorkstreamSnapshot, hash: string, previous: string | null) {
  return {
    workstreamId: value.workstreamId,
    revision: value.revision,
    status: value.status,
    snapshotContentHash: hash,
    previousSnapshotContentHash: previous,
    publishedAt: "2026-08-24T00:10:00.000Z",
  };
}

function local(chain: LocalWorkstreamRevision[]): WorkstreamReplicationLocalPort & { importCurrent: ReturnType<typeof vi.fn> } {
  return {
    readRevisionChain: async () => structuredClone(chain),
    importCurrent: vi.fn(async () => undefined),
  };
}

describe("workstream replication cycle", () => {
  it("imports a newer unique head after publishing local ancestry", async () => {
    const registration = createProjectRegistrationRequest({ manifest, destinationId, requestedAt: "2026-08-24T00:00:00.000Z" });
    const first = snapshot(1);
    const second = snapshot(2);
    const state = local([{ snapshot: first, snapshotContentHash: firstHash, previousSnapshotContentHash: null }]);
    const transport: AuthenticatedWorkstreamHubTransport = {
      publishWorkstream: async (request: WorkstreamReplicationPublishRequest) => response({
        schemaVersion: 1,
        status: "duplicate",
        projectId: request.projectId,
        repositoryIdentityHash: request.repositoryIdentityHash,
        heads: [head(second, secondHash, firstHash)],
      }),
      readWorkstream: async () => response({
        schemaVersion: 1,
        status: "current",
        projectId: registration.project.projectId,
        repositoryIdentityHash: registration.projectIdentityHash,
        heads: [head(second, secondHash, firstHash)],
        snapshot: second,
      }),
    };
    await expect(runWorkstreamReplicationCycle({
      local: state,
      transport,
      registration,
      destinationId,
      expectedPeerIdentityHash: peerIdentityHash,
    })).resolves.toEqual({ status: "imported", publishedCount: 0, imported: true, headCount: 1 });
    expect(state.importCurrent).toHaveBeenCalledWith({
      snapshot: second,
      snapshotContentHash: secondHash,
      previousSnapshotContentHash: firstHash,
    });
  });

  it("preserves divergent heads and never imports a winner", async () => {
    const registration = createProjectRegistrationRequest({ manifest, destinationId, requestedAt: "2026-08-24T00:00:00.000Z" });
    const first = snapshot(1);
    const second = snapshot(2);
    const state = local([{ snapshot: first, snapshotContentHash: firstHash, previousSnapshotContentHash: null }]);
    const heads = [head(second, secondHash, firstHash), head({ ...second, title: "Branch" }, branchHash, firstHash)];
    const transport: AuthenticatedWorkstreamHubTransport = {
      publishWorkstream: async () => response({
        schemaVersion: 1,
        status: "divergent",
        projectId: registration.project.projectId,
        repositoryIdentityHash: registration.projectIdentityHash,
        heads,
      }),
      readWorkstream: async () => response({
        schemaVersion: 1,
        status: "divergent",
        projectId: registration.project.projectId,
        repositoryIdentityHash: registration.projectIdentityHash,
        heads,
        snapshot: null,
      }),
    };
    await expect(runWorkstreamReplicationCycle({
      local: state,
      transport,
      registration,
      destinationId,
      expectedPeerIdentityHash: peerIdentityHash,
    })).resolves.toEqual({ status: "divergent", publishedCount: 1, imported: false, headCount: 2 });
    expect(state.importCurrent).not.toHaveBeenCalled();
  });
});
