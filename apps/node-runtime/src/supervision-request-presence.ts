import type { EventEnvelope } from "@lervo/schemas";
import type { EventStore } from "@lervo/storage-contract";
import { NodeSupervisionError, type NodeSupervisionBinding } from "./supervision-authority.js";

const maximumEvents = 100_000;

/** Finds only the exact durable goal-origin coordinate; it does not read or trust request prose. */
export function findBoundSupervisionRequestEvent(input: {
  events: Pick<EventStore, "list">;
  projectId: string;
  binding: NodeSupervisionBinding;
}): EventEnvelope | null {
  let afterSeq = 0;
  let observed = 0;
  let match: EventEnvelope | null = null;
  while (true) {
    const page = input.events.list({ afterSeq, limit: 1_000 });
    if (page.length === 0) break;
    observed += page.length;
    if (observed > maximumEvents)
      throw new Error("The supervised request history exceeds its observation bound.");
    for (const event of page) {
      if (
        event.type === "work.supervision.bound" &&
        event.schemaVersion === 3 &&
        event.projectId === input.projectId &&
        event.payload.supervisionId === input.binding.supervisionId &&
        event.payload.workstreamId === input.binding.workstreamId &&
        event.payload.ownerAgentId === input.binding.ownerAgentId
      ) {
        if (match !== null) throw new Error("The supervised goal has conflicting request origins.");
        match = event;
      }
    }
    afterSeq = page.at(-1)!.seq;
    if (page.length < 1_000) break;
  }
  return match;
}

/** Rejects work before any lease-side recovery, synchronization, reasoning, or effect can run. */
export function assertBoundSupervisionRequest(input: {
  events: Pick<EventStore, "list">;
  projectId: string;
  binding: NodeSupervisionBinding;
}): void {
  if (findBoundSupervisionRequestEvent(input) === null)
    throw new NodeSupervisionError("supervision_workstream_inactive");
}
