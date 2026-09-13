import type { OperatingActionPlanV1 } from "@lervo/application-contract";
import type { EventEnvelope } from "@lervo/schemas";
import { managedExecutionIdentity } from "./managed-execution-identity.js";
import { operatingContractHash, operatingDecisionId } from "./operating-mandate-admission.js";

/** Recovery validates the same bounded inspection that the fenced recorder persisted. */
export function isManagedExecutionAbsence(
  inspection: Record<string, unknown>,
  plan: OperatingActionPlanV1,
  sourceRevisionDigest: string,
): boolean {
  const identity = managedExecutionIdentity(plan.projectId, operatingContractHash(plan));
  return (
    ((inspection.schemaVersion === 4 &&
      Object.keys(inspection).length === 13 &&
      inspection.runEventsAbsent === true) ||
      (inspection.schemaVersion === 5 &&
        Object.keys(inspection).length === 15 &&
        inspection.runEventsAbsent === false &&
        inspection.reservationEventId === reservationEventId(identity) &&
        typeof inspection.reservationEventHash === "string" &&
        /^sha256:[a-f0-9]{64}$/u.test(inspection.reservationEventHash))) &&
    inspection.kind === "work.effect_absence" &&
    ["work.managed_execution.v1", "work.managed_execution.v2"].includes(plan.effectContract) &&
    inspection.effectContract === plan.effectContract &&
    inspection.decisionId === operatingDecisionId(plan) &&
    inspection.planHash === operatingContractHash(plan) &&
    inspection.effectHash === plan.effectHash &&
    inspection.sourceRevisionDigest === sourceRevisionDigest &&
    /^sha256:[a-f0-9]{64}$/u.test(sourceRevisionDigest) &&
    sourceRevisionDigest !== plan.sourceRevisionDigest &&
    inspection.runId === identity.runId &&
    inspection.sessionId === identity.sessionId &&
    typeof inspection.eventHeadHash === "string" &&
    /^sha256:[a-f0-9]{64}$/u.test(inspection.eventHeadHash) &&
    typeof inspection.observedAt === "string" &&
    Number.isFinite(Date.parse(inspection.observedAt)) &&
    (inspection.invalidatedBy === "source_changed" ||
      (inspection.invalidatedBy === "deadline_expired" &&
        Date.parse(plan.deadline) <= Date.parse(inspection.observedAt)))
  );
}

function reservationEventId(identity: { runId: string; sessionId: string }): string {
  return `evt_${operatingContractHash({ kind: "managed.execution.reserved", ...identity }).slice(7, 39)}`;
}

/** No requested run means no provider start; a new owner fence still precedes supersession. */
export function observeManagedExecutionAbsenceEvents(
  plan: OperatingActionPlanV1,
  events: readonly EventEnvelope[],
) {
  if (events.length === 0) return { schemaVersion: 4 as const, runEventsAbsent: true as const };
  if (events.length !== 1) return null;
  const event = events[0]!;
  const identity = managedExecutionIdentity(plan.projectId, operatingContractHash(plan));
  if (
    event.eventId !== reservationEventId(identity) ||
    event.projectId !== plan.projectId ||
    event.runId !== identity.runId ||
    event.sessionId !== identity.sessionId ||
    event.schemaVersion !== 3 ||
    event.actor.kind !== "system" ||
    event.type !== "managed.execution.reserved" ||
    Object.keys(event.payload).sort().join(",") !== "executionKey,requestHash" ||
    event.payload.executionKey !== operatingContractHash(plan) ||
    typeof event.payload.requestHash !== "string" ||
    !/^sha256:[a-f0-9]{64}$/u.test(event.payload.requestHash)
  )
    return null;
  return {
    schemaVersion: 5 as const,
    runEventsAbsent: false as const,
    reservationEventId: event.eventId,
    reservationEventHash: event.eventHash,
  };
}

export function managedExecutionAbsenceEventsMatch(
  inspection: Record<string, unknown>,
  plan: OperatingActionPlanV1,
  events: readonly EventEnvelope[],
): boolean {
  const observed = observeManagedExecutionAbsenceEvents(plan, events);
  return (
    observed !== null && Object.entries(observed).every(([key, value]) => inspection[key] === value)
  );
}
