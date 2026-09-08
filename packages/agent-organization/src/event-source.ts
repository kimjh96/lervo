import type { EventEnvelope } from "@lervo/schemas";

import { projectAgentContext } from "./agent-context-projection.js";
import type {
  AgentContextProjection,
  AgentContextWorkforceIdentity,
} from "./agent-context-types.js";
import { projectAgentOrganization } from "./projection.js";
import type { AgentOrganizationProjection } from "./types.js";

export interface AgentOrganizationEventSource {
  list(options: { afterSeq: number; limit: number }): EventEnvelope[];
}

export function readAgentOrganizationEventSource(
  events: AgentOrganizationEventSource,
): EventEnvelope[] {
  const result: EventEnvelope[] = [];
  let afterSeq = 0;
  while (true) {
    const page = events.list({ afterSeq, limit: 1_000 });
    result.push(...page);
    if (page.length < 1_000) return result;
    afterSeq = page.at(-1)!.seq;
  }
}

export function projectAgentOrganizationFromEventSource(input: {
  projectId: string;
  events: AgentOrganizationEventSource;
}): AgentOrganizationProjection {
  return projectAgentOrganization({
    projectId: input.projectId,
    events: readAgentOrganizationEventSource(input.events).filter((event) =>
      event.type.startsWith("organization."),
    ),
  });
}

export function projectAgentContextFromEventSource(input: {
  projectId: string;
  agentId: string;
  agents: readonly AgentContextWorkforceIdentity[];
  events: AgentOrganizationEventSource;
}): AgentContextProjection {
  return projectAgentContext({
    projectId: input.projectId,
    agentId: input.agentId,
    agents: input.agents,
    events: readAgentOrganizationEventSource(input.events),
  });
}
