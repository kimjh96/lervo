import { randomUUID } from "node:crypto";

import type {
  ConversationLeaseEvent,
  ConversationLeaseEventRecorder,
} from "@lervo/agent-workforce";
import { coordinationEventSchemaVersion } from "@lervo/event-contract";
import type { ProjectStorage } from "@lervo/project-storage";
import { sha256 } from "@lervo/repository-knowledge";

/** The parts of the registered repository's storage that recording a lease event needs. */
export type ConversationLeaseEventStore = Pick<
  ProjectStorage,
  "manifest" | "events" | "writableEventSchemaVersion"
>;

/** Whether the repository's writer selects event schema 16, the first that carries claims. */
export function conversationLeaseEventsWritable(storage: ConversationLeaseEventStore): boolean {
  return (storage.writableEventSchemaVersion ?? 1) >= coordinationEventSchemaVersion;
}

/**
 * Records a conversation's lease events, `assignment.lease.widened`, `assignment.claim.refused`,
 * and `assignment.lease.renewed`, as schema 16 envelopes in the registered repository's store,
 * beside the CLI's other workforce events. Below schema 16 each call throws, so a widening or a
 * renewal never commits without its event (ADR-0205) and a lease does not grow there.
 */
export function conversationLeaseEventRecorder(
  storage: ConversationLeaseEventStore,
): ConversationLeaseEventRecorder {
  return (event: ConversationLeaseEvent) => {
    if (!conversationLeaseEventsWritable(storage))
      throw Object.assign(
        new Error("The repository's writer selects an event schema below 16; claims are off."),
        { code: "coordination_inactive" },
      );
    const identity = randomUUID().replaceAll("-", "");
    storage.events.append({
      eventId: `evt_${identity}`,
      projectId: storage.manifest.projectId,
      runId: `run_${identity}`,
      sessionId: `ses_${identity}`,
      type: event.type,
      occurredAt: event.occurredAt,
      actor: { kind: "system" },
      schemaVersion: coordinationEventSchemaVersion,
      policyVersion: sha256(JSON.stringify(event.payload)),
      payload: { ...event.payload },
    });
  };
}
