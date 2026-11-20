import { createHash } from "node:crypto";

import { canonicalJson } from "@lervo/event-contract";
import type { WorkstreamReplicationPublishRequest, WorkstreamSnapshot } from "@lervo/schemas";
import { createProjectRegistrationRequest } from "@lervo/sync-contract";
import { describe, expect, it } from "vitest";

import {
  planWorkstreamReconciliation,
  reconcileDivergentWorkstream,
  type HubTransportResponse,
  type LocalWorkstreamRevision,
  type WorkstreamDivergenceCycle,
} from "../src/index.js";
import { destinationId, manifest, peerIdentityHash } from "./fixture.js";

const registration = createProjectRegistrationRequest({
  manifest,
  destinationId,
  requestedAt: "2026-11-02T00:00:00.000Z",
});

function snapshot(title: string, updatedAt: string): WorkstreamSnapshot {
  return {
    schemaVersion: 1,
    workstreamId: "wks_012301230123012301230123",
    revision: 2,
    status: "active",
    title,
    objective: "Continue the same work on two hosts.",
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
    updatedAt,
  };
}

function revision(value: WorkstreamSnapshot): LocalWorkstreamRevision {
  return {
    snapshot: value,
    snapshotContentHash: `sha256:${createHash("sha256")
      .update(`${canonicalJson(value)}\n`)
      .digest("hex")}`,
    previousSnapshotContentHash: `sha256:${"1".repeat(64)}`,
  };
}

function response(body: unknown): HubTransportResponse {
  return { authentication: { status: "verified", destinationId, peerIdentityHash }, body };
}

/** An in-memory Hub: every revision stays readable; a reconciliation replaces both heads. */
function hub(initial: LocalWorkstreamRevision[], options: { revisionReads?: boolean } = {}) {
  const stored = new Map(initial.map((item) => [item.snapshotContentHash, item]));
  let heads = [...initial];
  const published: WorkstreamReplicationPublishRequest[] = [];
  const head = (item: LocalWorkstreamRevision) => ({
    workstreamId: item.snapshot.workstreamId,
    revision: item.snapshot.revision,
    status: item.snapshot.status,
    snapshotContentHash: item.snapshotContentHash,
    previousSnapshotContentHash: item.previousSnapshotContentHash,
    publishedAt: "2026-11-02T00:00:00.000Z",
  });
  const coordinates = {
    projectId: registration.project.projectId,
    repositoryIdentityHash: registration.projectIdentityHash,
  };
  return {
    published,
    heads: () => heads,
    transport: {
      async readWorkstream() {
        return response({
          schemaVersion: 1,
          status: heads.length === 1 ? "current" : "divergent",
          ...coordinates,
          heads: heads.map(head),
          snapshot: heads.length === 1 ? heads[0]!.snapshot : null,
        });
      },
      async publishWorkstream(request: WorkstreamReplicationPublishRequest) {
        published.push(request);
        const item = {
          snapshot: request.snapshot,
          snapshotContentHash: request.snapshotContentHash,
          previousSnapshotContentHash: request.previousSnapshotContentHash,
        };
        const duplicate = stored.has(item.snapshotContentHash);
        stored.set(item.snapshotContentHash, item);
        if (!duplicate && request.snapshot.origin.reconciliationPredecessors !== undefined)
          heads = [item];
        return response({
          schemaVersion: 1,
          status: duplicate ? "duplicate" : "fast_forwarded",
          ...coordinates,
          heads: heads.map(head),
        });
      },
      ...(options.revisionReads === false
        ? {}
        : {
            async readWorkstreamRevision(hash: string) {
              const item = stored.get(hash)!;
              return response({
                schemaVersion: 1,
                ...coordinates,
                revision: head(item),
                isHead: heads.some((candidate) => candidate.snapshotContentHash === hash),
                snapshot: item.snapshot,
              });
            },
          }),
    },
  };
}

function cycle(
  transport: WorkstreamDivergenceCycle["transport"],
  chain: LocalWorkstreamRevision[],
): WorkstreamDivergenceCycle & { imported: LocalWorkstreamRevision[] } {
  const imported: LocalWorkstreamRevision[] = [];
  return {
    imported,
    local: {
      readRevisionChain: async () => [...chain, ...imported],
      verifyForPublish: async () => undefined,
      importCurrent: async (item) => {
        imported.push(item);
      },
    },
    transport,
    registration,
    destinationId,
    expectedPeerIdentityHash: peerIdentityHash,
  };
}

const mac = revision(snapshot("Mac continuation", "2026-11-02T01:00:00.000Z"));
const wsl = revision(snapshot("WSL continuation", "2026-11-02T02:00:00.000Z"));

describe("divergent workstream reconciliation", () => {
  it("keeps the newest valid head, preserves the other, and imports the successor", async () => {
    const server = hub([mac, wsl]);
    const node = cycle(server.transport, [mac]);
    const result = await reconcileDivergentWorkstream(node);
    expect(result).toMatchObject({
      status: "reconciled",
      kept: "hub",
      preserved: { snapshotContentHash: mac.snapshotContentHash },
      notice: { undo: `lervo workstream reconcile --restore ${mac.snapshotContentHash}` },
    });
    expect(node.imported).toHaveLength(1);
    expect(node.imported[0]!.snapshot).toMatchObject({
      title: "WSL continuation",
      revision: 1,
      origin: { predecessorSnapshotContentHash: wsl.snapshotContentHash },
    });
    expect(server.heads()).toHaveLength(1);
  });

  it("produces the identical successor on both hosts, so the second publication is a duplicate", () => {
    const fromMac = planWorkstreamReconciliation({
      projectId: registration.project.projectId,
      local: mac,
      peer: wsl,
    });
    const fromWsl = planWorkstreamReconciliation({
      projectId: registration.project.projectId,
      local: wsl,
      peer: mac,
    });
    expect(fromMac.kept).toBe("hub");
    expect(fromWsl.kept).toBe("local");
    expect(fromWsl.revision).toEqual(fromMac.revision);
    expect(fromWsl.planId).toBe(fromMac.planId);
  });

  it("holds more than two heads as Lervo debt without publishing", async () => {
    const third = revision(snapshot("Third continuation", "2026-11-02T03:00:00.000Z"));
    const server = hub([mac, wsl, third]);
    await expect(reconcileDivergentWorkstream(cycle(server.transport, [mac]))).resolves.toEqual({
      status: "held",
      reason: "more_than_two_heads",
      headCount: 3,
    });
    expect(server.published).toHaveLength(0);
  });

  it("fails closed on a Hub that cannot read an exact revision", async () => {
    const server = hub([mac, wsl], { revisionReads: false });
    await expect(
      reconcileDivergentWorkstream(cycle(server.transport, [mac])),
    ).rejects.toMatchObject({
      code: "hub_unavailable",
    });
    expect(server.published).toHaveLength(0);
  });

  it("does nothing while the Hub has one current head", async () => {
    const server = hub([mac]);
    await expect(reconcileDivergentWorkstream(cycle(server.transport, [mac]))).resolves.toEqual({
      status: "not_divergent",
    });
  });
});
