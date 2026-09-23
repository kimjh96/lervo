import type { EventEnvelope } from "@lervo/schemas";

import {
  validUnitInvocationWitness,
  type UnitInvocationWitness,
} from "./supervision-unit-invocation-proof.js";

const HASH = /^sha256:[a-f0-9]{64}$/u;
const PREFIX = [
  "managed.execution.reserved",
  "work.causality.recorded",
  "run.requested",
  "run.resolved",
] as const;
const NON_EFFECT_TYPES = new Set([
  ...PREFIX,
  "role.input.bound",
  "adapter.started",
  "provider.process.observed",
  "context.recommended",
  "context.selected",
  "document.loaded",
  "context.injected",
  "resource.usage.recorded",
  "execution.stages.observed",
  "run.failed",
]);

export interface InterruptedOwnerReasoningDiagnostic {
  schemaVersion: 1;
  kind: "work.owner_reasoning_interrupted_stop_failure";
  runEvents: { eventId: string; eventHash: string; type: string }[];
  witness: UnitInvocationWitness;
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).sort().join(",") === [...keys].sort().join(",");
}

/**
 * The existing failed terminal stays immutable. This proof only fences its process and removes an
 * impossible usage observation from the accounting population; the full reservation remains spent.
 */
export function isProvenInterruptedOwnerReasoning(
  events: readonly EventEnvelope[],
  reconciliation: EventEnvelope,
  diagnosticValue: unknown,
): diagnosticValue is InterruptedOwnerReasoningDiagnostic {
  const diagnostic = record(diagnosticValue);
  const terminal = events.at(-1);
  if (
    diagnostic === null ||
    !exactKeys(diagnostic, ["schemaVersion", "kind", "runEvents", "witness"]) ||
    diagnostic.schemaVersion !== 1 ||
    diagnostic.kind !== "work.owner_reasoning_interrupted_stop_failure" ||
    !Array.isArray(diagnostic.runEvents) ||
    diagnostic.runEvents.length !== events.length ||
    events.length < PREFIX.length + 5 ||
    events.length > 512 ||
    !PREFIX.every((type, index) => events[index]?.type === type) ||
    terminal?.type !== "run.failed" ||
    terminal.schemaVersion !== 1 ||
    terminal.actor.kind !== "system" ||
    terminal.payload.failureCode !== "provider_stop_failed" ||
    terminal.payload.retryable !== false ||
    !HASH.test(String(terminal.payload.diagnosticDigest)) ||
    reconciliation.type !== "work.supervision.owner_reasoning.interruption_reconciled" ||
    reconciliation.schemaVersion !== 3 ||
    reconciliation.actor.kind !== "system" ||
    reconciliation.seq <= terminal.seq ||
    reconciliation.projectId !== terminal.projectId ||
    reconciliation.payload.projectId !== terminal.projectId ||
    reconciliation.payload.managedRunId !== terminal.runId ||
    reconciliation.payload.terminalEventId !== terminal.eventId ||
    reconciliation.payload.planHash !== events[0]?.payload.executionKey ||
    !HASH.test(String(reconciliation.payload.diagnosticArtifactHash)) ||
    !validUnitInvocationWitness(diagnostic.witness, terminal.occurredAt, reconciliation.occurredAt)
  )
    return false;

  const witness = diagnostic.witness;
  const pinnedEvents = diagnostic.runEvents as unknown[];
  const started = events.filter((event) => event.type === "adapter.started");
  const processes = events.filter((event) => event.type === "provider.process.observed");
  const usage = events.filter((event) => event.type === "resource.usage.recorded");
  if (
    started.length !== 1 ||
    started[0]!.actor.kind !== "provider" ||
    started[0]!.payload.executionMode !== "read_only" ||
    started[0]!.seq <= events[PREFIX.length - 1]!.seq ||
    processes.length === 0 ||
    processes.some(
      (event) =>
        event.actor.kind !== "provider" ||
        event.actor.provider !== started[0]!.actor.provider ||
        event.payload.provesWorkProgress !== false,
    ) ||
    usage.length !== 1 ||
    usage[0]!.actor.kind !== "provider" ||
    usage[0]!.actor.provider !== started[0]!.actor.provider ||
    usage[0]!.payload.source !== "provider_reported" ||
    usage[0]!.payload.status !== "unavailable" ||
    usage[0]!.payload.usage !== null ||
    usage[0]!.payload.reasonCode !== "resource_observation_missing" ||
    usage[0]!.seq <= started[0]!.seq ||
    usage[0]!.seq >= terminal.seq ||
    events.some((event) => !NON_EFFECT_TYPES.has(event.type)) ||
    events.filter((event) => event.type === "run.failed").length !== 1 ||
    events[1]!.payload.workstreamId !== reconciliation.payload.workstreamId ||
    events[1]!.payload.agentId !== reconciliation.payload.ownerAgentId ||
    events[1]!.payload.assignmentId !== null
  )
    return false;

  return events.every((event, index) => {
    const pinned = record(pinnedEvents[index]);
    const at = Date.parse(event.occurredAt);
    return (
      event.projectId === terminal.projectId &&
      event.runId === terminal.runId &&
      event.sessionId === terminal.sessionId &&
      (index === 0 || events[index - 1]!.seq < event.seq) &&
      event.seq < reconciliation.seq &&
      Number.isFinite(at) &&
      Date.parse(witness.incidentInvocationFirstAt) <= at &&
      at <= Date.parse(witness.incidentInvocationLastAt) &&
      pinned !== null &&
      exactKeys(pinned, ["eventId", "eventHash", "type"]) &&
      pinned.eventId === event.eventId &&
      pinned.eventHash === event.eventHash &&
      pinned.type === event.type
    );
  });
}
