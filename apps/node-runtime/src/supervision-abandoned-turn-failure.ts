import type { EventEnvelope } from "@lervo/schemas";
import {
  validUnitInvocationWitness,
  type UnitInvocationWitness,
} from "./supervision-unit-invocation-proof.js";

const PREFIX = [
  "managed.execution.reserved",
  "work.causality.recorded",
  "run.requested",
  "run.resolved",
  "role.input.bound",
] as const;
const EFFECT_TYPES = [
  "tool.called",
  "command.executed",
  "file.changed",
  "capability.activated",
  "capability.invoked",
  "unmanaged_change.detected",
] as const;
export type AbandonedTurnInvocationWitness = UnitInvocationWitness;

export interface AbandonedTurnFailureDiagnostic {
  schemaVersion: 1;
  kind: "work.managed_abandoned_turn_failure";
  failures: [{ code: "interrupted_after_turn_start"; phase: "recovery"; retryable: false }];
  runEvents: { eventId: string; eventHash: string; type: string }[];
  witness: AbandonedTurnInvocationWitness;
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
 * A provider session that opened and was then killed with its owning process proves no work and no
 * usage. The proof settles the run as terminal and never claims the turn was safe to repeat: the
 * adapter must have been read-only, nothing may prove work progress, and no effect event may exist.
 */
export function isProvenAbandonedTurnFailure(
  events: readonly EventEnvelope[],
  diagnosticValue: unknown,
): diagnosticValue is AbandonedTurnFailureDiagnostic {
  const terminal = events.at(-1);
  const original = events.slice(0, -1);
  const diagnostic = record(diagnosticValue);
  const failure = Array.isArray(diagnostic?.failures) ? record(diagnostic.failures[0]) : null;
  if (
    terminal === undefined ||
    diagnostic === null ||
    !exactKeys(diagnostic, ["schemaVersion", "kind", "failures", "runEvents", "witness"]) ||
    diagnostic.schemaVersion !== 1 ||
    diagnostic.kind !== "work.managed_abandoned_turn_failure" ||
    !Array.isArray(diagnostic.failures) ||
    diagnostic.failures.length !== 1 ||
    failure === null ||
    !exactKeys(failure, ["code", "phase", "retryable"]) ||
    failure.code !== "interrupted_after_turn_start" ||
    failure.phase !== "recovery" ||
    failure.retryable !== false ||
    !Array.isArray(diagnostic.runEvents) ||
    diagnostic.runEvents.length !== original.length
  )
    return false;
  const started = original.filter((event) => event.type === "adapter.started");
  const processes = original.filter((event) => event.type === "provider.process.observed");
  if (
    original.length < PREFIX.length + 1 ||
    !PREFIX.every((type, index) => original[index]?.type === type) ||
    started.length !== 1 ||
    started[0]!.payload.executionMode !== "read_only" ||
    started[0]!.seq <= original[PREFIX.length - 1]!.seq ||
    processes.length === 0 ||
    processes.some((event) => event.payload.provesWorkProgress !== false) ||
    original.some(
      (event) =>
        EFFECT_TYPES.includes(event.type as (typeof EFFECT_TYPES)[number]) ||
        event.type === "resource.usage.recorded" ||
        event.type === "adapter.stopped" ||
        event.type === "run.completed" ||
        event.type === "run.failed",
    )
  )
    return false;
  const runEvents = diagnostic.runEvents as unknown[];
  const witness = diagnostic.witness;
  if (
    !validUnitInvocationWitness(witness, original.at(-1)!.occurredAt, terminal.occurredAt) ||
    terminal.type !== "run.failed" ||
    terminal.schemaVersion !== 1 ||
    terminal.actor.kind !== "system" ||
    !exactKeys(terminal.payload as Record<string, unknown>, [
      "failureCode",
      "retryable",
      "diagnosticDigest",
    ]) ||
    terminal.payload.failureCode !== "interrupted_after_turn_start" ||
    terminal.payload.retryable !== false ||
    events.some(
      (event) =>
        event.projectId !== terminal.projectId ||
        event.runId !== terminal.runId ||
        event.sessionId !== terminal.sessionId,
    )
  )
    return false;
  return original.every((event, index) => {
    const pinned = record(runEvents[index]);
    return (
      event.seq < terminal.seq &&
      (index === 0 || original[index - 1]!.seq < event.seq) &&
      Date.parse(witness.incidentInvocationFirstAt) <= Date.parse(event.occurredAt) &&
      Date.parse(event.occurredAt) <= Date.parse(witness.incidentInvocationLastAt) &&
      pinned !== null &&
      exactKeys(pinned, ["eventId", "eventHash", "type"]) &&
      pinned.eventId === event.eventId &&
      pinned.eventHash === event.eventHash &&
      pinned.type === event.type
    );
  });
}
