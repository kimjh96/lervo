import { describe, expect, it } from "vitest";

import { requiredSyncRoutePermission, syncRoutePermitted } from "../src/sync-route-permission.js";

describe("sync route permission", () => {
  it("names the explicit permission of every route kind", () => {
    expect(requiredSyncRoutePermission("knowledge-convergence-owner", "GET")).toBe(
      "workspace.read",
    );
    expect(requiredSyncRoutePermission("knowledge-convergence-hosts", "POST")).toBe(
      "workspace.coordinate",
    );
    expect(requiredSyncRoutePermission("workspace-reservations", "POST")).toBe(
      "workspace.coordinate",
    );
    expect(requiredSyncRoutePermission("workstreams", "GET")).toBe("workstream.read");
    expect(requiredSyncRoutePermission("event-batches", "POST")).toBe("sync.write");
  });

  it("lets sync.write coordinate knowledge routes only", () => {
    for (const kind of [
      "knowledge-convergence-owner",
      "knowledge-instruction-candidates",
      "knowledge-convergence-hosts",
    ] as const)
      for (const method of ["GET", "POST"])
        expect(syncRoutePermitted({ kind, method, permissions: ["sync.write"] })).toBe(true);
    expect(
      syncRoutePermitted({
        kind: "workspace-reservations",
        method: "POST",
        permissions: ["sync.write"],
      }),
    ).toBe(false);
    expect(
      syncRoutePermitted({ kind: "workstreams", method: "POST", permissions: ["sync.write"] }),
    ).toBe(false);
    expect(
      syncRoutePermitted({
        kind: "knowledge-convergence-owner",
        method: "POST",
        permissions: ["trace.read"],
      }),
    ).toBe(false);
  });
});
