import type {
  AgentContextProjection,
  AgentOrganizationProjection,
  ProjectedAgentContextEntry,
} from "@lervo/agent-organization";

export interface AgentContextDocumentEntry {
  contextEntryId: string;
  ownerAgentId: string;
  layer: ProjectedAgentContextEntry["layer"];
  source: ProjectedAgentContextEntry["source"];
  promotedAt: string;
  summary: string;
}

export function selectAgentContextEntries(
  context: AgentContextProjection,
  maximumEntries: number,
): ProjectedAgentContextEntry[] {
  const selected = [...context.entries.filter((entry) => entry.status === "active")];
  for (const entry of context.inheritedEntries) {
    if (!selected.some((candidate) => candidate.contextEntryId === entry.contextEntryId)) {
      selected.push(entry);
    }
  }
  return selected
    .sort((left, right) => right.promotedAt.localeCompare(left.promotedAt))
    .slice(0, maximumEntries);
}

export function renderAgentContextDocument(input: {
  context: AgentContextProjection;
  organization: AgentOrganizationProjection;
  entries: readonly AgentContextDocumentEntry[];
}): string {
  const membership = input.organization.memberships.find(
    (item) => item.agentId === input.context.agent.agentId && item.status === "active",
  );
  return `${JSON.stringify(
    {
      schemaVersion: 1,
      kind: "lervo_agent_context_projection",
      projectId: input.context.projectId,
      agent: input.context.agent,
      organization:
        membership === undefined || input.organization.team === null
          ? null
          : {
              organizationId: input.organization.team.organizationId,
              teamId: input.organization.team.teamId,
              membershipId: membership.membershipId,
            },
      readOnly: input.context.readOnly,
      entries: input.entries,
      inheritedHandoffIds: input.context.incomingHandoffs.map((item) => item.contextHandoffId),
      sourceEventHeadSequence: input.context.lastSequence,
    },
    null,
    2,
  )}\n`;
}
