import { describe, expect, it } from "vitest";

import { HubControlReviewGrants } from "../src/index.js";

const coordinate = {
  principalId: "operator:reviewer",
  destinationId: "hub:primary",
  projectId: "prj_control01",
  deliveryId: `rcd_${"a".repeat(64)}`,
};

describe("Hub control review grant", () => {
  it("binds a short-lived review link to the exact reauthenticated principal and command", () => {
    const grants = new HubControlReviewGrants(Buffer.alloc(32, 7), { ttlSeconds: 600 });
    const grant = grants.issue({ ...coordinate, issuedAt: "2026-08-20T00:00:00.000Z" });

    expect(grant).toMatch(/^hcrg_[0-9]{10}_[a-f0-9]{64}$/);
    expect(grant).not.toContain(coordinate.principalId);
    expect(
      grants.verify({
        ...coordinate,
        grant,
        verifiedAt: "2026-08-20T00:10:00.000Z",
      }),
    ).toBe(true);
    expect(
      grants.verify({
        ...coordinate,
        principalId: "operator:different",
        grant,
        verifiedAt: "2026-08-20T00:01:00.000Z",
      }),
    ).toBe(false);
    expect(
      grants.verify({
        ...coordinate,
        deliveryId: `rcd_${"b".repeat(64)}`,
        grant,
        verifiedAt: "2026-08-20T00:01:00.000Z",
      }),
    ).toBe(false);
    expect(
      grants.verify({
        ...coordinate,
        grant,
        verifiedAt: "2026-08-19T23:59:59.000Z",
      }),
    ).toBe(false);
    expect(
      grants.verify({
        ...coordinate,
        grant,
        verifiedAt: "2026-08-20T00:10:01.000Z",
      }),
    ).toBe(false);
  });
});
