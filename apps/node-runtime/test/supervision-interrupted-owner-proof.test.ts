import { expect, it } from "vitest";
import type { EventEnvelope } from "@lervo/schemas";

import {
  isProvenInterruptedOwnerReasoning,
  type InterruptedOwnerReasoningDiagnostic,
} from "../src/supervision-interrupted-owner-proof.js";

const baseAt = Date.parse("2026-09-23T19:46:00.000Z");
const hash = `sha256:${"a".repeat(64)}`;
const projectId = `prj_${"a".repeat(16)}`;
const runId = `run_${"b".repeat(32)}`;
const sessionId = `ses_${"b".repeat(32)}`;
const planHash = `sha256:${"c".repeat(64)}`;
const ownerAgentId = `agt_${"d".repeat(24)}`;
const workstreamId = `wks_${"e".repeat(24)}`;

function event(
  seq: number,
  type: string,
  payload: Record<string, unknown>,
  schemaVersion = 1,
): EventEnvelope {
  return {
    eventId: `evt_${seq.toString(16).padStart(32, "0")}`,
    eventHash: `sha256:${seq.toString(16).padStart(64, "0")}`,
    previousHash: hash,
    projectId,
    runId,
    sessionId,
    seq,
    type,
    schemaVersion,
    actor: ["adapter.started", "provider.process.observed", "resource.usage.recorded"].includes(
      type,
    )
      ? { kind: "provider", provider: "codex" }
      : { kind: "system" },
    policyVersion: hash,
    occurredAt: new Date(baseAt + seq * 1000).toISOString(),
    payload,
  } as EventEnvelope;
}

function fixture() {
  const events = [
    event(1, "managed.execution.reserved", { executionKey: planHash }, 3),
    event(2, "work.causality.recorded", {
      workstreamId,
      agentId: ownerAgentId,
      assignmentId: null,
    }),
    event(3, "run.requested", {}),
    event(4, "run.resolved", {}),
    event(5, "adapter.started", { executionMode: "read_only" }),
    event(6, "provider.process.observed", { provesWorkProgress: false }, 2),
    event(7, "context.injected", {}),
    event(
      8,
      "resource.usage.recorded",
      {
        source: "provider_reported",
        status: "unavailable",
        usage: null,
        reasonCode: "resource_observation_missing",
      },
      2,
    ),
    event(9, "execution.stages.observed", {}),
    event(10, "run.failed", {
      failureCode: "provider_stop_failed",
      retryable: false,
      diagnosticDigest: hash,
    }),
  ];
  const reconciliation = {
    ...event(11, "work.supervision.owner_reasoning.interruption_reconciled", {}, 3),
    runId: `run_${"f".repeat(32)}`,
    payload: {
      projectId,
      workstreamId,
      ownerAgentId,
      managedRunId: runId,
      terminalEventId: events.at(-1)!.eventId,
      planHash,
      diagnosticArtifactHash: hash,
    },
  } as EventEnvelope;
  const diagnostic: InterruptedOwnerReasoningDiagnostic = {
    schemaVersion: 1,
    kind: "work.owner_reasoning_interrupted_stop_failure",
    runEvents: events.map(({ eventId, eventHash, type }) => ({ eventId, eventHash, type })),
    witness: {
      schemaVersion: 1,
      kind: "host.unit_invocation_witness",
      unit: "lervo-node-fixture.service",
      incidentAt: events.at(-1)!.occurredAt,
      incidentInvocationId: "1".repeat(32),
      incidentInvocationFirstAt: new Date(baseAt).toISOString(),
      incidentInvocationLastAt: new Date(baseAt + 10_000).toISOString(),
      successorInvocationId: "2".repeat(32),
      successorInvocationFirstAt: new Date(baseAt + 10_000).toISOString(),
      currentInvocationId: "3".repeat(32),
      inventorySha256: hash,
      observedAt: new Date(baseAt + 10_500).toISOString(),
    },
  };
  return { events, reconciliation, diagnostic };
}

it("proves an exact read-only owner stop failure without estimating its token usage", () => {
  const { events, reconciliation, diagnostic } = fixture();
  expect(isProvenInterruptedOwnerReasoning(events, reconciliation, diagnostic)).toBe(true);
});

it.each([
  "writable adapter",
  "provider work progress",
  "observed usage",
  "tool effect",
  "late event",
  "different terminal",
  "stale witness",
  "changed run hash",
] as const)("refuses %s", (scenario) => {
  const { events, reconciliation, diagnostic } = fixture();
  if (scenario === "writable adapter") events[4]!.payload.executionMode = "workspace_write";
  if (scenario === "provider work progress") events[5]!.payload.provesWorkProgress = true;
  if (scenario === "observed usage") events[7]!.payload.status = "observed";
  if (scenario === "tool effect") events[6]!.type = "tool.called";
  if (scenario === "late event") events.push(event(12, "context.injected", {}));
  if (scenario === "different terminal")
    reconciliation.payload.terminalEventId = event(12, "run.failed", {}).eventId;
  if (scenario === "stale witness")
    diagnostic.witness.observedAt = new Date(baseAt - 10_000).toISOString();
  if (scenario === "changed run hash") diagnostic.runEvents[6]!.eventHash = hash;
  expect(isProvenInterruptedOwnerReasoning(events, reconciliation, diagnostic)).toBe(false);
});
