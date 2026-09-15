import type { EventEnvelope } from "@lervo/schemas";
import { describe, expect, it } from "vitest";

import {
  isProvenAbandonedTurnFailure,
  type AbandonedTurnFailureDiagnostic,
} from "../src/supervision-abandoned-turn-failure.js";

const RUN = `run_${"a".repeat(32)}`;
const SESSION = `ses_${"b".repeat(32)}`;
const PROJECT = "prj_1111111111111111";
const START = Date.parse("2026-09-15T04:12:23.000Z");

function event(
  seq: number,
  type: string,
  offsetMs: number,
  payload: Record<string, unknown> = {},
): EventEnvelope {
  return {
    eventId: `evt_${seq.toString(16).padStart(32, "0")}`,
    eventHash: `sha256:${seq.toString(16).padStart(64, "0")}`,
    projectId: PROJECT,
    runId: RUN,
    sessionId: SESSION,
    seq,
    type,
    occurredAt: new Date(START + offsetMs).toISOString(),
    schemaVersion: 3,
    actor: { kind: "system" },
    policyVersion: `sha256:${"c".repeat(64)}`,
    payload,
  } as unknown as EventEnvelope;
}

function scenario(overrides: { original?: EventEnvelope[]; retryable?: boolean } = {}) {
  const original = overrides.original ?? [
    event(1, "managed.execution.reserved", 0),
    event(2, "work.causality.recorded", 1000),
    event(3, "run.requested", 2000),
    event(4, "run.resolved", 3000),
    event(5, "role.input.bound", 4000),
    event(6, "adapter.started", 23_000, { executionMode: "read_only" }),
    event(7, "provider.process.observed", 23_100, { provesWorkProgress: false }),
    event(8, "context.injected", 30_000),
  ];
  const incidentAt = original.at(-1)!.occurredAt;
  const observedAt = new Date(START + 600_000).toISOString();
  const terminal = {
    ...original.at(-1)!,
    eventId: `evt_${"f".repeat(32)}`,
    eventHash: `sha256:${"f".repeat(64)}`,
    seq: 99,
    type: "run.failed",
    schemaVersion: 1,
    actor: { kind: "system" },
    occurredAt: new Date(START + 601_000).toISOString(),
    payload: {
      failureCode: "interrupted_after_turn_start",
      retryable: overrides.retryable ?? false,
      diagnosticDigest: `sha256:${"d".repeat(64)}`,
    },
  } as unknown as EventEnvelope;
  const diagnostic: AbandonedTurnFailureDiagnostic = {
    schemaVersion: 1,
    kind: "work.managed_abandoned_turn_failure",
    failures: [{ code: "interrupted_after_turn_start", phase: "recovery", retryable: false }],
    runEvents: original.map((item) => ({
      eventId: item.eventId,
      eventHash: item.eventHash,
      type: item.type,
    })),
    witness: {
      schemaVersion: 1,
      kind: "host.unit_invocation_witness",
      unit: "lervo-node-28de5803e2db5aec8bd4ee7d.service",
      incidentAt,
      incidentInvocationId: "a".repeat(32),
      incidentInvocationFirstAt: new Date(START - 1000).toISOString(),
      incidentInvocationLastAt: new Date(START + 60_000).toISOString(),
      successorInvocationId: "b".repeat(32),
      successorInvocationFirstAt: new Date(START + 120_000).toISOString(),
      currentInvocationId: "c".repeat(32),
      inventorySha256: `sha256:${"e".repeat(64)}`,
      observedAt,
    },
  };
  return { events: [...original, terminal], diagnostic };
}

describe("abandoned managed turn proof", () => {
  it("settles a session that opened and died with its owning unit instance", () => {
    const { events, diagnostic } = scenario();
    expect(isProvenAbandonedTurnFailure(events, diagnostic)).toBe(true);
  });

  it("refuses a run that reported provider usage", () => {
    const { events, diagnostic } = scenario();
    const withUsage = scenario({
      original: [
        ...events.slice(0, -1),
        event(9, "resource.usage.recorded", 31_000, { source: "provider_reported" }),
      ],
    });
    expect(isProvenAbandonedTurnFailure(withUsage.events, withUsage.diagnostic)).toBe(false);
    expect(isProvenAbandonedTurnFailure(events, diagnostic)).toBe(true);
  });

  it("refuses a writable adapter, a proven work turn, an effect event, or a retryable terminal", () => {
    const writable = scenario({
      original: [
        ...scenario().events.slice(0, 5),
        event(6, "adapter.started", 23_000, { executionMode: "write" }),
        event(7, "provider.process.observed", 23_100, { provesWorkProgress: false }),
        event(8, "context.injected", 30_000),
      ],
    });
    expect(isProvenAbandonedTurnFailure(writable.events, writable.diagnostic)).toBe(false);
    const progressed = scenario({
      original: [
        ...scenario().events.slice(0, 5),
        event(6, "adapter.started", 23_000, { executionMode: "read_only" }),
        event(7, "provider.process.observed", 23_100, { provesWorkProgress: true }),
        event(8, "context.injected", 30_000),
      ],
    });
    expect(isProvenAbandonedTurnFailure(progressed.events, progressed.diagnostic)).toBe(false);
    const acted = scenario({
      original: [
        ...scenario().events.slice(0, 5),
        event(6, "adapter.started", 23_000, { executionMode: "read_only" }),
        event(7, "provider.process.observed", 23_100, { provesWorkProgress: false }),
        event(8, "tool.called", 30_000),
      ],
    });
    expect(isProvenAbandonedTurnFailure(acted.events, acted.diagnostic)).toBe(false);
    const retryable = scenario({ retryable: true });
    expect(isProvenAbandonedTurnFailure(retryable.events, retryable.diagnostic)).toBe(false);
  });

  it("refuses a witness without a completed successor invocation fence", () => {
    const { events, diagnostic } = scenario();
    const same = {
      ...diagnostic,
      witness: {
        ...diagnostic.witness,
        successorInvocationId: diagnostic.witness.incidentInvocationId,
      },
    };
    expect(isProvenAbandonedTurnFailure(events, same)).toBe(false);
    const overlapping = {
      ...diagnostic,
      witness: {
        ...diagnostic.witness,
        successorInvocationFirstAt: diagnostic.witness.incidentInvocationLastAt,
      },
    };
    expect(isProvenAbandonedTurnFailure(events, overlapping)).toBe(false);
  });
});
