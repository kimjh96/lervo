import type { EventEnvelope } from "@lervo/schemas";

import { projectAgentOrganization } from "./projection.js";
import type { AgentOrganizationProjection } from "./types.js";

export interface AgentOrganizationEventSource {
  list(options: { afterSeq: number; limit: number }): EventEnvelope[];
}

export function projectAgentOrganizationFromEventSource(input: {
  projectId: string;
  events: AgentOrganizationEventSource;
}): AgentOrganizationProjection {
  const organizationEvents: EventEnvelope[] = [];
  let afterSeq = 0;
  while (true) {
    const page = input.events.list({ afterSeq, limit: 1_000 });
    for (const event of page) {
      afterSeq = event.seq;
      if (event.type.startsWith("organization.")) organizationEvents.push(event);
    }
    if (page.length < 1_000) {
      return projectAgentOrganization({
        projectId: input.projectId,
        events: organizationEvents,
      });
    }
  }
}
