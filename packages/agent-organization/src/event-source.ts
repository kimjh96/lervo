import type { EventEnvelope } from "@lervo/schemas";

import { agentContextEventTypes } from "./agent-context-event-validation.js";
import { projectAgentContext } from "./agent-context-projection.js";
import type {
  AgentContextEventEnvelope,
  AgentContextProjection,
  AgentContextWorkforceIdentity,
} from "./agent-context-types.js";
import { agentOrganizationEventTypes } from "./event-validation.js";
import { projectAgentOrganization } from "./projection.js";
import { AgentOrganizationError, type AgentOrganizationProjection } from "./types.js";

export interface AgentOrganizationEventSource {
  list(options: { afterSeq: number; limit: number; types: readonly string[] }): EventEnvelope[];
}

/** A source that can also fix one observed head and resolve events by ID within it. */
export interface AgentContextEventSource extends AgentOrganizationEventSource {
  latest(): EventEnvelope | null;
  get(eventId: string): EventEnvelope | null;
}

const pageSize = 1_000;
/** Bounds the matched events a reader retains, never the length of project history (ADR-0554). */
const maximumRetainedEvents = 100_000;

/**
 * Reads only the given event types in project order, through `throughSeq` when supplied. Pages
 * must move forward and hold only the requested types; the retained matches are bounded.
 */
export function readAgentOrganizationEventSource(
  events: AgentOrganizationEventSource,
  types: readonly string[] = agentOrganizationEventTypes,
  throughSeq?: number,
): EventEnvelope[] {
  if (types.length === 0) throw new TypeError("types must not be empty.");
  const requested = new Set(types);
  const result: EventEnvelope[] = [];
  let afterSeq = 0;
  while (true) {
    const page = events.list({ afterSeq, limit: pageSize, types });
    for (const event of page) {
      if (event.seq <= afterSeq || !requested.has(event.type)) {
        throw new AgentOrganizationError(
          "organization_event_invalid",
          "The event source did not return a forward page of the requested event types.",
        );
      }
      afterSeq = event.seq;
      if (throughSeq !== undefined && event.seq > throughSeq) return result;
      if (result.length === maximumRetainedEvents) {
        throw new AgentOrganizationError(
          "organization_event_invalid",
          `Organization events exceed the retained limit of ${maximumRetainedEvents}.`,
        );
      }
      result.push(event);
    }
    if (page.length < pageSize) return result;
  }
}

export function projectAgentOrganizationFromEventSource(input: {
  projectId: string;
  events: AgentOrganizationEventSource;
  throughSeq?: number;
}): AgentOrganizationProjection {
  return projectAgentOrganization({
    projectId: input.projectId,
    events: readAgentOrganizationEventSource(
      input.events,
      agentOrganizationEventTypes,
      input.throughSeq,
    ),
  });
}

/**
 * Reads the agent-context events through one head. The review and source events a promotion
 * names are not context events, so they are looked up by ID within the same head.
 */
export function readAgentContextEventSource(
  events: AgentContextEventSource,
  throughSeq = events.latest()?.seq ?? 0,
): {
  throughSeq: number;
  events: AgentContextEventEnvelope[];
  lookupEvent(eventId: string): AgentContextEventEnvelope | undefined;
} {
  return {
    throughSeq,
    events: readAgentOrganizationEventSource(events, agentContextEventTypes, throughSeq),
    lookupEvent: (eventId) => {
      const event = events.get(eventId);
      return event !== null && event.seq <= throughSeq ? event : undefined;
    },
  };
}

export function projectAgentContextFromEventSource(input: {
  projectId: string;
  agentId: string;
  agents: readonly AgentContextWorkforceIdentity[];
  events: AgentContextEventSource;
}): AgentContextProjection {
  const source = readAgentContextEventSource(input.events);
  return projectAgentContext({
    projectId: input.projectId,
    agentId: input.agentId,
    agents: input.agents,
    events: source.events,
    lookupEvent: source.lookupEvent,
    observedThroughSeq: source.throughSeq,
  });
}
