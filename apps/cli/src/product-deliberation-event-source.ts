import { agentOrganizationEventTypes } from "@lervo/agent-organization";
import { collectWorkExecutionEvents } from "@lervo/diagnostics";
import type { ProjectStorage } from "@lervo/project-storage";
import type { EventEnvelope } from "@lervo/schemas";
import { visitEventsOfTypes } from "@lervo/storage-contract";

import { ProductDeliberationSourceError } from "./product-deliberation-policy.js";

/** Bounds the matching events retained, never the length of project history. */
const maximumProjectionEvents = 100_000;
/**
 * Event types the policy, participant, and application projections consume. The work resource
 * report reads its own causal and run history through `collectWorkExecutionEvents`.
 */
const deliberationProjectionEventTypes = [
  "deliberation.started",
  "deliberation.artifact.recorded",
  "deliberation.completed",
  "verification.completed",
  ...agentOrganizationEventTypes,
];

export interface VerifiedDeliberationEvents {
  events: EventEnvelope[];
  eventCount: number;
  headHash: string;
}

/** Explicit verification proves the whole chain; the projections then read only their types. */
export function readVerifiedEvents(storage: ProjectStorage): VerifiedDeliberationEvents {
  const integrity = storage.events.verifyIntegrity();
  if (!integrity.valid || integrity.headHash === null || integrity.eventCount < 1) {
    throw new ProductDeliberationSourceError(
      "deliberation_source_invalid",
      "The deliberation projection requires one valid canonical event chain.",
    );
  }
  let events: EventEnvelope[];
  try {
    // Bounded inside the verified snapshot, so later appends never exhaust the bound.
    const retained: EventEnvelope[] = [];
    visitEventsOfTypes({
      events: storage.events,
      types: deliberationProjectionEventTypes,
      throughSeq: integrity.eventCount,
      visit: (event) => {
        if (retained.length >= maximumProjectionEvents)
          throw new Error("The deliberation projection events exceed their bound.");
        retained.push(event);
      },
    });
    events = retained;
  } catch (error) {
    throw new ProductDeliberationSourceError(
      "deliberation_source_invalid",
      "The deliberation projection events exceed their bound or could not be read.",
      { cause: error },
    );
  }
  return { events, eventCount: integrity.eventCount, headHash: integrity.headHash };
}

/**
 * Reads one work's causal and run history through the verified head, then proves the head is
 * unchanged so every projection input belongs to the same verified snapshot.
 */
export function readVerifiedWorkEvents(
  storage: ProjectStorage,
  source: VerifiedDeliberationEvents,
  workId: string,
): EventEnvelope[] {
  let events: EventEnvelope[];
  try {
    events = collectWorkExecutionEvents({
      events: storage.events,
      workId,
      throughSeq: source.eventCount,
    });
  } catch (error) {
    throw new ProductDeliberationSourceError(
      "deliberation_source_invalid",
      "The deliberation work events exceed their bound or could not be read.",
      { cause: error },
    );
  }
  const head = storage.events.list({ afterSeq: source.eventCount - 1, limit: 1 })[0];
  if (head?.seq !== source.eventCount || head.eventHash !== source.headHash) {
    throw new ProductDeliberationSourceError(
      "deliberation_source_changed",
      "The canonical event head changed during deliberation inspection.",
    );
  }
  return events;
}
