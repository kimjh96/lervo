import type {
  AdapterCapabilityActivationReceipt,
  AdapterCapabilityActivationRequest,
  AdapterNormalizedEvent,
} from "@lervo/schemas";
import { describe, expect, it } from "vitest";

import { capabilityInvocationSpecs } from "../src/provider-run-events.js";

const hash = `sha256:${"a".repeat(64)}` as const;
const request: AdapterCapabilityActivationRequest = {
  kind: "capability_activation_request",
  schemaVersion: 1,
  capabilityId: "repository/search",
  capabilityKind: "mcp_server",
  version: "1.0.0",
  contentHash: hash,
  runtime: {
    kind: "mcp_stdio",
    serverName: "repository-search",
    command: "node",
    arguments: ["server.mjs"],
    credentialNames: [],
    timeoutMs: 5_000,
  },
};
const receipt: AdapterCapabilityActivationReceipt = {
  kind: "capability_activation_receipt",
  schemaVersion: 1,
  adapterId: "adapter_fixture",
  projectId: "prj_0123456789abcdef",
  runId: "run_0123456789abcdef",
  sessionId: "ses_0123456789abcdef",
  providerSessionId: "provider-session",
  capabilityId: request.capabilityId,
  capabilityKind: request.capabilityKind,
  version: request.version,
  contentHash: request.contentHash,
  evidence: "mcp_connected",
  activationDigest: hash,
  confirmedAt: "2026-08-25T00:00:00.000Z",
};

function toolEvent(toolName: string, status: "in_progress" | "completed"): AdapterNormalizedEvent {
  return {
    kind: "normalized_event",
    schemaVersion: 1,
    eventId: "evt_0123456789abcdef",
    projectId: receipt.projectId,
    runId: receipt.runId,
    sessionId: receipt.sessionId,
    providerSessionId: receipt.providerSessionId,
    type: "provider.tool.called",
    occurredAt: "2026-08-25T00:00:01.000Z",
    payload: {
      providerItemId: "provider-item",
      toolName,
      inputDigest: hash,
      status,
      durationMs: status === "completed" ? 4 : null,
    },
  };
}

describe("capability invocation evidence", () => {
  it("records only calls bound to an adapter-confirmed MCP server", () => {
    const input = {
      requests: [request],
      receipts: [receipt],
      provider: "fixture",
      recordedAt: "2026-08-25T00:00:02.000Z",
    };

    expect(
      capabilityInvocationSpecs({
        ...input,
        event: toolEvent("mcp__repository-search__query", "in_progress"),
      }),
    ).toMatchObject([{ type: "capability.invoked" }]);
    expect(
      capabilityInvocationSpecs({
        ...input,
        event: toolEvent("mcp__repository-search__query", "completed"),
      }),
    ).toMatchObject([{ type: "capability.completed", payload: { status: "completed" } }]);
    expect(
      capabilityInvocationSpecs({
        ...input,
        event: toolEvent("mcp__another-server__query", "completed"),
      }),
    ).toEqual([]);
    expect(
      capabilityInvocationSpecs({
        ...input,
        receipts: [],
        event: toolEvent("mcp__repository-search__query", "completed"),
      }),
    ).toEqual([]);
  });
});
