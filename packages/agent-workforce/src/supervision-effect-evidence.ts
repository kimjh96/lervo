import type { EventStore } from "@lervo/storage-contract";
import { operatingContractHash } from "@lervo/work-controller";

type Event = NonNullable<ReturnType<EventStore["get"]>>;

/** Causal receipt guard; the concrete effect inspector proves exact artifacts and run history. */
export function isDecisionBoundSupervisionEffectEvidence(
  event: Event,
  decision: Event,
  events: EventStore,
): boolean {
  if (
    decision.payload.actionKind === "execute_as_owner" &&
    event.type === "work.supervision.owner_reasoning.interruption_reconciled"
  ) {
    const terminal = events.get(String(event.payload.terminalEventId));
    return (
      event.schemaVersion === 3 &&
      event.actor.kind === "system" &&
      event.runId === decision.runId &&
      event.eventId ===
        `evt_${operatingContractHash({ runId: decision.runId, type: event.type, identity: decision.payload.decisionId }).slice(7, 39)}` &&
      [
        "supervisionId",
        "workstreamId",
        "workstreamRevision",
        "ownerAgentId",
        "mandateHash",
        "decisionId",
        "planHash",
      ].every((key) => event.payload[key] === decision.payload[key]) &&
      terminal?.type === "run.failed" &&
      terminal.runId === event.payload.managedRunId &&
      ["provider_stop_failed", "provider_start_failed"].includes(
        String(terminal.payload.failureCode),
      ) &&
      terminal.payload.retryable === false &&
      terminal.seq < event.seq &&
      Array.isArray(event.payload.causationEventIds) &&
      event.payload.causationEventIds.length === 2 &&
      event.payload.causationEventIds[0] === decision.eventId &&
      event.payload.causationEventIds[1] === terminal.eventId
    );
  }
  if (
    decision.payload.actionKind === "escalate" &&
    event.type === "work.supervision.escalation.recorded"
  )
    return (
      event.schemaVersion === 3 &&
      event.actor.kind === "system" &&
      event.runId === decision.runId &&
      event.eventId ===
        `evt_${operatingContractHash({ runId: decision.runId, type: event.type, identity: decision.payload.decisionId }).slice(7, 39)}` &&
      ["supervisionId", "workstreamId", "workstreamRevision", "ownerAgentId", "mandateHash"].every(
        (key) => event.payload[key] === decision.payload[key],
      ) &&
      event.payload.escalationId === decision.payload.decisionId &&
      event.payload.decisionArtifactHash === decision.payload.planHash &&
      Array.isArray(event.payload.causationEventIds) &&
      event.payload.causationEventIds.length === 1 &&
      event.payload.causationEventIds[0] === decision.eventId
    );
  if (
    (decision.payload.actionKind === "publish_result" &&
      event.type === "work.supervision.delivery.queued") ||
    (decision.payload.actionKind === "execute_as_owner" &&
      ["work.supervision.workspace.prepared", "work.supervision.handoff.accepted"].includes(
        event.type,
      )) ||
    (["request_team_support", "escalate"].includes(String(decision.payload.actionKind)) &&
      event.type === "work.supervision.handoff.offered")
  )
    return (
      event.schemaVersion === 3 &&
      event.actor.kind === "system" &&
      event.runId === decision.runId &&
      event.eventId ===
        `evt_${operatingContractHash({ runId: decision.runId, type: event.type, identity: decision.payload.decisionId }).slice(7, 39)}` &&
      [
        "supervisionId",
        "workstreamId",
        "workstreamRevision",
        "ownerAgentId",
        "mandateHash",
        "decisionId",
        "planHash",
      ].every((key) => event.payload[key] === decision.payload[key]) &&
      Array.isArray(event.payload.causationEventIds) &&
      event.payload.causationEventIds.length === 1 &&
      event.payload.causationEventIds[0] === decision.eventId
    );
  return (
    decision.payload.actionKind === "execute_as_owner" &&
    event.type === "work.supervision.review.recorded" &&
    event.schemaVersion === 3 &&
    event.actor.kind === "system" &&
    event.runId === decision.runId &&
    event.eventId ===
      `evt_${operatingContractHash({
        runId: decision.runId,
        type: "work.supervision.review.recorded",
        identity: decision.payload.decisionId,
      }).slice(7, 39)}` &&
    ["supervisionId", "workstreamId", "workstreamRevision", "ownerAgentId", "mandateHash"].every(
      (key) => event.payload[key] === decision.payload[key],
    ) &&
    event.payload.reviewerAgentId === decision.payload.ownerAgentId &&
    Array.isArray(event.payload.causationEventIds) &&
    event.payload.causationEventIds[0] === decision.eventId
  );
}
