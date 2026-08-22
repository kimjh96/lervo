import { describe, expect, it, vi } from "vitest";

import { cleanupHubCommandArtifacts, type HubCommandArtifactPurgeClaim } from "../src/index.js";

const claim: HubCommandArtifactPurgeClaim = {
  claimId: `hcg_${"a".repeat(32)}`,
  kind: "expired",
  artifactUri: `lervo-cas://sha256/${"b".repeat(64)}`,
  workerId: "hub:cleanup-test",
  claimedAt: "2026-08-22T00:00:00.000Z",
  leaseExpiresAt: "2026-08-22T00:01:00.000Z",
};

function fixture(deleteObject: () => Promise<{ deleted: boolean }>) {
  const completedAt: string[] = [];
  const releasedAt: string[] = [];
  return {
    completedAt,
    releasedAt,
    repository: {
      async claimExpiredArtifacts() { return [structuredClone(claim)]; },
      async claimOrphanArtifact() { return null; },
      async completeArtifactPurge(input: { completedAt: string }) {
        completedAt.push(input.completedAt);
        return {
          status: "completed" as const,
          kind: "expired" as const,
          purgedDeliveryCount: 1,
          continuationRecommended: false,
        };
      },
      async releaseArtifactPurgeClaim(input: { releasedAt: string }) {
        releasedAt.push(input.releasedAt);
      },
    },
    artifacts: {
      async put() { throw new Error("not called"); },
      async get() { throw new Error("not called"); },
      async listObjects() { return { items: [], nextCursor: null }; },
      deleteObject,
    },
  };
}

describe("Hub command artifact cleanup cycle time", () => {
  it("uses a fresh completion time instead of reusing the retention cutoff", async () => {
    const setup = fixture(async () => ({ deleted: true }));
    await expect(cleanupHubCommandArtifacts({
      repository: setup.repository,
      artifacts: setup.artifacts,
      workerId: claim.workerId,
      cleanedAt: claim.claimedAt,
      now: () => "2026-08-22T00:00:10.000Z",
      limit: 2,
    })).resolves.toMatchObject({ deletedCount: 1, failureCount: 0 });
    expect(setup.completedAt).toEqual(["2026-08-22T00:00:10.000Z"]);
  });

  it("uses a fresh release time and recommends a prompt retry after partial failure", async () => {
    const setup = fixture(vi.fn(async () => { throw new Error("delete failed"); }));
    await expect(cleanupHubCommandArtifacts({
      repository: setup.repository,
      artifacts: setup.artifacts,
      workerId: claim.workerId,
      cleanedAt: claim.claimedAt,
      now: () => "2026-08-22T00:00:20.000Z",
      limit: 2,
    })).resolves.toMatchObject({
      claimedCount: 1,
      failureCount: 1,
      continuationRecommended: true,
    });
    expect(setup.releasedAt).toEqual(["2026-08-22T00:00:20.000Z"]);
  });
});
