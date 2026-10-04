import type { EventEnvelope } from "@lervo/schemas";
import type { EventStore } from "@lervo/storage-contract";
import { NodeSupervisionError, type NodeSupervisionBinding } from "./supervision-authority.js";
import { VerifiedEventTail } from "./verified-event-tail.js";

const maximumEvents = 100_000;
const boundMessage = "The supervised request history exceeds its observation bound.";
const boundRequestTypes = ["work.supervision.bound"] as const;
/** Matches the authority history full audit: an out-of-band rewrite is caught within 15 minutes. */
const presenceFullReadIntervalMs = 900_000;

type PresenceEvents = Pick<EventStore, "get" | "latest" | "list">;

function isBoundRequestEvent(
  event: EventEnvelope,
  projectId: string,
  binding: NodeSupervisionBinding,
): boolean {
  return (
    event.type === "work.supervision.bound" &&
    event.schemaVersion === 3 &&
    event.projectId === projectId &&
    event.payload.supervisionId === binding.supervisionId &&
    event.payload.workstreamId === binding.workstreamId &&
    event.payload.ownerAgentId === binding.ownerAgentId
  );
}

function accumulateBoundRequest(
  match: EventEnvelope | null,
  events: readonly EventEnvelope[],
  projectId: string,
  binding: NodeSupervisionBinding,
): EventEnvelope | null {
  let current = match;
  for (const event of events) {
    if (!isBoundRequestEvent(event, projectId, binding)) continue;
    if (current !== null) throw new Error("The supervised goal has conflicting request origins.");
    current = event;
  }
  return current;
}

/** Finds only the exact durable goal-origin coordinate; it does not read or trust request prose. */
export function findBoundSupervisionRequestEvent(input: {
  events: PresenceEvents;
  projectId: string;
  binding: NodeSupervisionBinding;
}): EventEnvelope | null {
  const tail = new VerifiedEventTail({
    types: boundRequestTypes,
    maximumEvents,
    fullReadIntervalMs: presenceFullReadIntervalMs,
    boundMessage,
  });
  return accumulateBoundRequest(
    null,
    tail.read(input.events).events,
    input.projectId,
    input.binding,
  );
}

/**
 * The same answer as `findBoundSupervisionRequestEvent` for one fixed binding, read incrementally.
 * Matching is a per-event predicate and a duplicate always throws, so scanning the verified prefix
 * once and then each appended tail yields the full scan's result, including a conflicting origin
 * appended later. Any failure discards the cursor so the next check is a full scan again.
 */
export class BoundSupervisionRequestPresence {
  private readonly tail: VerifiedEventTail;
  private match: EventEnvelope | null = null;

  constructor(
    private readonly input: {
      events: PresenceEvents;
      projectId: string;
      binding: NodeSupervisionBinding;
      now?: () => number;
    },
  ) {
    this.tail = new VerifiedEventTail({
      types: boundRequestTypes,
      maximumEvents,
      fullReadIntervalMs: presenceFullReadIntervalMs,
      boundMessage,
      ...(input.now === undefined ? {} : { now: input.now }),
    });
  }

  find(): EventEnvelope | null {
    try {
      const read = this.tail.read(this.input.events);
      this.match = accumulateBoundRequest(
        read.restarted ? null : this.match,
        read.events,
        this.input.projectId,
        this.input.binding,
      );
      return this.match === null ? null : structuredClone(this.match);
    } catch (error) {
      this.tail.reset();
      this.match = null;
      throw error;
    }
  }

  /** Rejects work before any lease-side recovery, synchronization, reasoning, or effect can run. */
  assert(): void {
    if (this.find() === null) throw new NodeSupervisionError("supervision_workstream_inactive");
  }
}
