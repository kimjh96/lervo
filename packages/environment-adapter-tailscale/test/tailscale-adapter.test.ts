import { describe, expect, it } from "vitest";

import { TailscaleEnvironmentAdapter } from "../src/index.js";

const source = {
  schemaVersion: 1 as const,
  sourceId: "src_tailscale_local",
  adapterId: "tailscale",
  scope: "project" as const,
  capabilities: ["network.peer"],
  maximumValiditySeconds: 60,
  sharing: "local_only" as const,
  configuration: {},
};

describe("TailscaleEnvironmentAdapter", () => {
  it("redacts provider identities and emits provider-neutral endpoints", async () => {
    const rawId = "n123-provider-secret-identity";
    const adapter = new TailscaleEnvironmentAdapter({
      executables: ["fixture-tailscale"],
      runner: async () => ({ stdout: JSON.stringify({
        BackendState: "Running",
        Self: { ID: "self-id", HostName: "mac", DNSName: "mac.tail.example.", OS: "macOS", Online: true, TailscaleIPs: ["100.64.0.1"], UserID: 123 },
        Peer: {
          opaqueMapKey: { ID: rawId, HostName: "windows", DNSName: "windows.tail.example.", OS: "windows", Online: true, Active: true, TailscaleIPs: ["100.64.0.2"] },
        },
      }) }),
    });
    const result = await adapter.query({ source });
    expect(result.status).toBe("available");
    expect(result.subjects).toHaveLength(2);
    expect(result.subjects[1]).toMatchObject({
      kind: "device",
      labels: { "device.hostname": "windows", "device.os": "windows", "network.online": "true" },
      capabilities: ["network.peer"],
      endpoints: [
        { transport: "overlay", addressKind: "dns", host: "windows.tail.example" },
        { transport: "overlay", addressKind: "ip", host: "100.64.0.2" },
      ],
    });
    expect(JSON.stringify(result)).not.toContain(rawId);
    expect(JSON.stringify(result)).not.toContain("opaqueMapKey");
    expect(JSON.stringify(result)).not.toContain("UserID");
  });

  it("returns a bounded failure code instead of command output", async () => {
    const adapter = new TailscaleEnvironmentAdapter({
      executables: ["fixture-tailscale"],
      runner: async () => { throw Object.assign(new Error("sensitive stderr"), { code: "EACCES" }); },
    });
    expect(await adapter.query({ source })).toEqual({
      status: "unavailable",
      subjects: [],
      verification: [{ kind: "source_session", status: "unavailable", failureCode: "source_command_failed" }],
    });
  });
});
