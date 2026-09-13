import type { EventEnvelope } from "@lervo/schemas";

const PREFIX = [
  "managed.execution.reserved",
  "work.causality.recorded",
  "run.requested",
  "run.resolved",
  "role.input.bound",
] as const;
const HASH = /^sha256:[a-f0-9]{64}$/u;
const BOOT_ID = /^[a-f0-9]{32}$/u;

export interface PreTurnBootWitness {
  schemaVersion: 1;
  kind: "host.boot_transition_witness";
  incidentAt: string;
  incidentBootId: string;
  incidentBootFirstAt: string;
  incidentBootLastAt: string;
  successorBootId: string;
  successorBootFirstAt: string;
  currentBootId: string;
  inventorySha256: string;
  observedAt: string;
}

export interface PreTurnFailureDiagnostic {
  schemaVersion: 1;
  kind: "work.managed_pre_turn_failure";
  failures: [{ code: "interrupted_before_turn"; phase: "recovery"; retryable: true }];
  runEvents: { eventId: string; eventHash: string; type: string }[];
  witness: PreTurnBootWitness;
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).sort().join(",") === [...keys].sort().join(",");
}

function instant(value: unknown): number {
  return typeof value === "string" ? Date.parse(value) : NaN;
}

/** A completed host reboot fences the old process; the exact pre-start prefix fences model turns. */
export function isProvenPreTurnFailure(
  events: readonly EventEnvelope[],
  diagnosticValue: unknown,
): diagnosticValue is PreTurnFailureDiagnostic {
  if (events.length !== PREFIX.length + 1) return false;
  const diagnostic = record(diagnosticValue);
  const failure = Array.isArray(diagnostic?.failures) ? record(diagnostic.failures[0]) : null;
  if (
    diagnostic === null ||
    !exactKeys(diagnostic, ["schemaVersion", "kind", "failures", "runEvents", "witness"]) ||
    diagnostic.schemaVersion !== 1 ||
    diagnostic.kind !== "work.managed_pre_turn_failure" ||
    !Array.isArray(diagnostic.failures) ||
    diagnostic.failures.length !== 1 ||
    failure === null ||
    !exactKeys(failure, ["code", "phase", "retryable"]) ||
    failure.code !== "interrupted_before_turn" ||
    failure.phase !== "recovery" ||
    failure.retryable !== true ||
    !Array.isArray(diagnostic.runEvents) ||
    diagnostic.runEvents.length !== PREFIX.length
  )
    return false;
  const witness = record(diagnostic.witness);
  const runEvents = diagnostic.runEvents as unknown[];
  if (
    witness === null ||
    !exactKeys(witness, [
      "schemaVersion",
      "kind",
      "incidentAt",
      "incidentBootId",
      "incidentBootFirstAt",
      "incidentBootLastAt",
      "successorBootId",
      "successorBootFirstAt",
      "currentBootId",
      "inventorySha256",
      "observedAt",
    ]) ||
    witness.schemaVersion !== 1 ||
    witness.kind !== "host.boot_transition_witness" ||
    !BOOT_ID.test(String(witness.incidentBootId)) ||
    !BOOT_ID.test(String(witness.successorBootId)) ||
    !BOOT_ID.test(String(witness.currentBootId)) ||
    witness.incidentBootId === witness.successorBootId ||
    witness.incidentBootId === witness.currentBootId ||
    !HASH.test(String(witness.inventorySha256))
  )
    return false;
  const incident = instant(witness.incidentAt);
  const first = instant(witness.incidentBootFirstAt);
  const last = instant(witness.incidentBootLastAt);
  const successor = instant(witness.successorBootFirstAt);
  const observed = instant(witness.observedAt);
  const terminal = events.at(-1)!;
  const terminalAt = instant(terminal.occurredAt);
  if (
    ![incident, first, last, successor, observed, terminalAt].every(Number.isFinite) ||
    first > incident ||
    incident > last ||
    last >= successor ||
    successor > observed ||
    observed > terminalAt ||
    terminalAt - observed > 5_000 ||
    witness.incidentAt !== events[4]!.occurredAt ||
    terminal.type !== "run.failed" ||
    terminal.schemaVersion !== 1 ||
    terminal.actor.kind !== "system" ||
    terminal.payload.failureCode !== "interrupted_before_turn" ||
    terminal.payload.retryable !== true ||
    events.some(
      (event) =>
        event.projectId !== terminal.projectId ||
        event.runId !== terminal.runId ||
        event.sessionId !== terminal.sessionId,
    )
  )
    return false;
  return PREFIX.every((type, index) => {
    const event = events[index]!;
    const pinned = record(runEvents[index]);
    return (
      event.type === type &&
      event.seq < terminal.seq &&
      (index === 0 || events[index - 1]!.seq < event.seq) &&
      first <= instant(event.occurredAt) &&
      instant(event.occurredAt) <= last &&
      pinned !== null &&
      exactKeys(pinned, ["eventId", "eventHash", "type"]) &&
      pinned.eventId === event.eventId &&
      pinned.eventHash === event.eventHash &&
      pinned.type === event.type
    );
  });
}
