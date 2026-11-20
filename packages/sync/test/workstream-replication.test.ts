import type { WorkstreamReplicationPublishRequest, WorkstreamSnapshot } from "@lervo/schemas";
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
    origin: {
      kind: "created",
      sourceArtifactId: null,
      sourceContentHash: null,
      sourcePathDigest: null,
    },
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

function local(
  chain: LocalWorkstreamRevision[],
): WorkstreamReplicationLocalPort & { importCurrent: ReturnType<typeof vi.fn> } {
  return {
    readRevisionChain: async () => structuredClone(chain),
    verifyForPublish: async () => undefined,
    importCurrent: vi.fn(async () => undefined),
  };
}

describe("workstream replication cycle", () => {
  it("finishes a current cycle with one read and no duplicate publications", async () => {
    const registration = createProjectRegistrationRequest({
      manifest,
      destinationId,
      requestedAt: "2026-08-24T00:00:00.000Z",
    });
    const first = snapshot(1);
    const second = snapshot(2);
    const state = local([
      { snapshot: first, snapshotContentHash: firstHash, previousSnapshotContentHash: null },
      { snapshot: second, snapshotContentHash: secondHash, previousSnapshotContentHash: firstHash },
    ]);
    const publishWorkstream = vi.fn<AuthenticatedWorkstreamHubTransport["publishWorkstream"]>();
    const readWorkstream = vi.fn(async () =>
      response({
        schemaVersion: 1,
        status: "current",
        projectId: registration.project.projectId,
        repositoryIdentityHash: registration.projectIdentityHash,
        heads: [head(second, secondHash, firstHash)],
        snapshot: second,
      }),
    );

    await expect(
      runWorkstreamReplicationCycle({
        local: state,
        transport: { publishWorkstream, readWorkstream },
        registration,
        destinationId,
        expectedPeerIdentityHash: peerIdentityHash,
      }),
    ).resolves.toEqual({ status: "current", publishedCount: 0, imported: false, headCount: 1 });
    expect(publishWorkstream).not.toHaveBeenCalled();
    expect(readWorkstream).toHaveBeenCalledTimes(1);
  });

  it("publishes only the suffix after a disclosed local ancestor", async () => {
    const registration = createProjectRegistrationRequest({
      manifest,
      destinationId,
      requestedAt: "2026-08-24T00:00:00.000Z",
    });
    const first = snapshot(1);
    const second = snapshot(2);
    const state = local([
      { snapshot: first, snapshotContentHash: firstHash, previousSnapshotContentHash: null },
      { snapshot: second, snapshotContentHash: secondHash, previousSnapshotContentHash: firstHash },
    ]);
    const publishWorkstream = vi.fn(async (request: WorkstreamReplicationPublishRequest) =>
      response({
        schemaVersion: 1,
        status: "fast_forwarded",
        projectId: request.projectId,
        repositoryIdentityHash: request.repositoryIdentityHash,
        heads: [head(second, secondHash, firstHash)],
      }),
    );
    const readWorkstream = vi
      .fn()
      .mockResolvedValueOnce(
        response({
          schemaVersion: 1,
          status: "current",
          projectId: registration.project.projectId,
          repositoryIdentityHash: registration.projectIdentityHash,
          heads: [head(first, firstHash, null)],
          snapshot: first,
        }),
      )
      .mockResolvedValueOnce(
        response({
          schemaVersion: 1,
          status: "current",
          projectId: registration.project.projectId,
          repositoryIdentityHash: registration.projectIdentityHash,
          heads: [head(second, secondHash, firstHash)],
          snapshot: second,
        }),
      );

    await expect(
      runWorkstreamReplicationCycle({
        local: state,
        transport: { publishWorkstream, readWorkstream },
        registration,
        destinationId,
        expectedPeerIdentityHash: peerIdentityHash,
      }),
    ).resolves.toEqual({ status: "published", publishedCount: 1, imported: false, headCount: 1 });
    expect(publishWorkstream).toHaveBeenCalledTimes(1);
    expect(publishWorkstream.mock.calls[0]?.[0].snapshotContentHash).toBe(secondHash);
    expect(readWorkstream).toHaveBeenCalledTimes(2);
  });

  it("publishes nothing when the revisions changed after they were read (ADR-0602)", async () => {
    const registration = createProjectRegistrationRequest({
      manifest,
      destinationId,
      requestedAt: "2026-08-24T00:00:00.000Z",
    });
    const first = snapshot(1);
    const second = snapshot(2);
    const state = local([
      { snapshot: first, snapshotContentHash: firstHash, previousSnapshotContentHash: null },
      { snapshot: second, snapshotContentHash: secondHash, previousSnapshotContentHash: firstHash },
    ]);
    const verifyForPublish = vi.fn(async (_revisions: readonly LocalWorkstreamRevision[]) => {
      throw new Error("A local workstream event changed before use.");
    });
    const publishWorkstream = vi.fn();
    const readWorkstream = vi.fn().mockResolvedValue(
      response({
        schemaVersion: 1,
        status: "current",
        projectId: registration.project.projectId,
        repositoryIdentityHash: registration.projectIdentityHash,
        heads: [head(first, firstHash, null)],
        snapshot: first,
      }),
    );
    await expect(
      runWorkstreamReplicationCycle({
        local: { ...state, verifyForPublish },
        transport: { publishWorkstream, readWorkstream },
        registration,
        destinationId,
        expectedPeerIdentityHash: peerIdentityHash,
      }),
    ).rejects.toMatchObject({ code: "local_state_invalid" });
    expect(verifyForPublish.mock.calls[0]?.[0]).toEqual([
      { snapshot: second, snapshotContentHash: secondHash, previousSnapshotContentHash: firstHash },
    ]);
    expect(publishWorkstream).not.toHaveBeenCalled();
  });

  it("imports a newer unique head after publishing local ancestry", async () => {
    const registration = createProjectRegistrationRequest({
      manifest,
      destinationId,
      requestedAt: "2026-08-24T00:00:00.000Z",
    });
    const first = snapshot(1);
    const second = snapshot(2);
    const state = local([
      { snapshot: first, snapshotContentHash: firstHash, previousSnapshotContentHash: null },
    ]);
    const transport: AuthenticatedWorkstreamHubTransport = {
      publishWorkstream: async (request: WorkstreamReplicationPublishRequest) =>
        response({
          schemaVersion: 1,
          status: "duplicate",
          projectId: request.projectId,
          repositoryIdentityHash: request.repositoryIdentityHash,
          heads: [head(second, secondHash, firstHash)],
        }),
      readWorkstream: async () =>
        response({
          schemaVersion: 1,
          status: "current",
          projectId: registration.project.projectId,
          repositoryIdentityHash: registration.projectIdentityHash,
          heads: [head(second, secondHash, firstHash)],
          snapshot: second,
        }),
    };
    await expect(
      runWorkstreamReplicationCycle({
        local: state,
        transport,
        registration,
        destinationId,
        expectedPeerIdentityHash: peerIdentityHash,
      }),
    ).resolves.toEqual({ status: "imported", publishedCount: 0, imported: true, headCount: 1 });
    expect(state.importCurrent).toHaveBeenCalledWith({
      snapshot: second,
      snapshotContentHash: secondHash,
      previousSnapshotContentHash: firstHash,
    });
  });

  it("imports a separate successor only when it names the completed local head", async () => {
    const registration = createProjectRegistrationRequest({
      manifest,
      destinationId,
      requestedAt: "2026-08-24T00:00:00.000Z",
    });
    const completed = { ...snapshot(1), status: "completed" as const };
    const successor: WorkstreamSnapshot = {
      ...snapshot(1),
      workstreamId: "wks_abcdefabcdefabcdefabcdef",
      origin: {
        kind: "successor",
        sourceArtifactId: null,
        sourceContentHash: null,
        sourcePathDigest: null,
        predecessorWorkstreamId: completed.workstreamId,
        predecessorSnapshotContentHash: firstHash,
      },
    };
    const state = local([
      { snapshot: completed, snapshotContentHash: firstHash, previousSnapshotContentHash: null },
    ]);
    const transport: AuthenticatedWorkstreamHubTransport = {
      publishWorkstream: async (request) =>
        response({
          schemaVersion: 1,
          status: "duplicate",
          projectId: request.projectId,
          repositoryIdentityHash: request.repositoryIdentityHash,
          heads: [head(successor, secondHash, firstHash)],
        }),
      readWorkstream: async () =>
        response({
          schemaVersion: 1,
          status: "current",
          projectId: registration.project.projectId,
          repositoryIdentityHash: registration.projectIdentityHash,
          heads: [head(successor, secondHash, firstHash)],
          snapshot: successor,
        }),
    };
    await expect(
      runWorkstreamReplicationCycle({
        local: state,
        transport,
        registration,
        destinationId,
        expectedPeerIdentityHash: peerIdentityHash,
      }),
    ).resolves.toMatchObject({ status: "imported", imported: true });
    expect(state.importCurrent).toHaveBeenCalledWith({
      snapshot: successor,
      snapshotContentHash: secondHash,
      previousSnapshotContentHash: firstHash,
    });
  });

  it("preserves divergent heads and never imports a winner", async () => {
    const registration = createProjectRegistrationRequest({
      manifest,
      destinationId,
      requestedAt: "2026-08-24T00:00:00.000Z",
    });
    const first = snapshot(1);
    const second = snapshot(2);
    const state = local([
      { snapshot: first, snapshotContentHash: firstHash, previousSnapshotContentHash: null },
    ]);
    const heads = [
      head(second, secondHash, firstHash),
      head({ ...second, title: "Branch" }, branchHash, firstHash),
    ];
    const transport: AuthenticatedWorkstreamHubTransport = {
      publishWorkstream: async () =>
        response({
          schemaVersion: 1,
          status: "divergent",
          projectId: registration.project.projectId,
          repositoryIdentityHash: registration.projectIdentityHash,
          heads,
        }),
      readWorkstream: async () =>
        response({
          schemaVersion: 1,
          status: "divergent",
          projectId: registration.project.projectId,
          repositoryIdentityHash: registration.projectIdentityHash,
          heads,
          snapshot: null,
        }),
    };
    await expect(
      runWorkstreamReplicationCycle({
        local: state,
        transport,
        registration,
        destinationId,
        expectedPeerIdentityHash: peerIdentityHash,
      }),
    ).resolves.toEqual({ status: "divergent", publishedCount: 1, imported: false, headCount: 2 });
    expect(state.importCurrent).not.toHaveBeenCalled();
  });
});
