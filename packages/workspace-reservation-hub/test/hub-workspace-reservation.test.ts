import { describe, expect, it, vi } from "vitest";

import { hubWorkspaceCoordinationDigest } from "@lervo/hub-sync";

import {
  HubWorkspaceReservationAdapter,
  type HubWorkspaceCoordinationTransport,
} from "../src/index.js";

const hash = (character: string) => `sha256:${character.repeat(64)}`;
const claim = {
  reservationId: "hrs_0123456789abcdef01234567",
  projectId: "prj_workspace_hub_01",
  repositoryIdentityHash: hash("1"),
  assignmentId: "asn_0123456789abcdef01234567",
  workspaceId: "wsp_0123456789abcdef01234567",
  nodeId: "nod_node_0001",
  generation: 1,
  baseCommit: "a".repeat(40),
  integrationTargetDigest: hash("2"),
  scopes: [{ scopeDigest: hash("3"), ancestorDigests: [hash("3")] }],
  requestedAt: "2026-08-26T00:00:00.000Z",
  expiresAt: "2026-08-26T00:05:00.000Z",
  localLeaseExpiresAt: "2026-08-26T00:05:00.000Z",
  idempotencyKey: "idk_workspace_hub_0001",
};

describe("Hub workspace reservation adapter", () => {
  it("binds the exact path-private claim and accepts only verified Hub decisions", async () => {
    const coordinateWorkspace = vi.fn<HubWorkspaceCoordinationTransport["coordinateWorkspace"]>(
      async (mutation) => {
        expect(mutation.operation).toBe("reserve");
        if (mutation.operation !== "reserve") throw new Error("unexpected mutation");
        const { contentHash, ...content } = mutation.request;
        expect(contentHash).toBe(hubWorkspaceCoordinationDigest(content));
        expect(JSON.stringify(mutation)).not.toContain("src/private.ts");
        return {
          authentication: { status: "verified" },
          body: {
            status: "granted",
            reservation: {
              ...mutation.request,
              state: "granted",
              requestContentHash: contentHash,
              revision: 1,
              updatedAt: claim.requestedAt,
            },
          },
        };
      },
    );
    await expect(
      new HubWorkspaceReservationAdapter({ coordinateWorkspace }).reserve(claim),
    ).resolves.toEqual({
      status: "granted",
      reservationId: claim.reservationId,
      expiresAt: claim.expiresAt,
    });
  });

  it("fails closed when transport, authentication, or response validation is unavailable", async () => {
    const unavailable = new HubWorkspaceReservationAdapter({
      coordinateWorkspace: vi.fn(async () => {
        throw new Error("offline");
      }),
    });
    await expect(unavailable.reserve(claim)).resolves.toEqual({ status: "unavailable" });
    const unverified = new HubWorkspaceReservationAdapter({
      coordinateWorkspace: vi.fn(async () => ({
        authentication: { status: "unverified" },
        body: { status: "granted" },
      })),
    });
    await expect(unverified.reserve(claim)).resolves.toEqual({ status: "unavailable" });
  });

  it("requires an authenticated release acknowledgement", async () => {
    const coordinateWorkspace = vi.fn<HubWorkspaceCoordinationTransport["coordinateWorkspace"]>(
      async (mutation) => ({
        authentication: { status: "verified" },
        body: { status: mutation.operation === "release" ? "released" : "invalid" },
      }),
    );
    const adapter = new HubWorkspaceReservationAdapter({ coordinateWorkspace });
    await expect(
      adapter.release({
        reservationId: claim.reservationId,
        projectId: claim.projectId,
        repositoryIdentityHash: claim.repositoryIdentityHash,
        nodeId: claim.nodeId,
        generation: claim.generation,
        releasedAt: "2026-08-26T00:01:00.000Z",
      }),
    ).resolves.toBeUndefined();
  });
});
