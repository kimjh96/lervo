import { createHash } from "node:crypto";

import type {
  AgentContextProjection,
  AgentOrganizationProjection,
  GovernedAgentContextEntry,
  ProjectedAgentContextEntry,
} from "@lervo/agent-organization";
import { hasCompleteGovernedAgentContextMetadata } from "@lervo/agent-organization";

export interface AgentContextDocumentEntry {
  contextEntryId: string;
  ownerAgentId: string;
  layer: ProjectedAgentContextEntry["layer"];
  memoryKind: GovernedAgentContextEntry["memoryKind"];
  subjectKey: string;
  confidence: GovernedAgentContextEntry["confidence"];
  observedAt: string;
  expiresAt: string | null;
  source: ProjectedAgentContextEntry["source"];
  promotedAt: string;
  summary: string;
}

export function selectAgentContextEntries(
  context: AgentContextProjection,
  maximumEntries: number,
  input: { query: string; at: Date },
): GovernedAgentContextEntry[] {
  const selected = [...context.entries.filter((entry) => entry.status === "active")];
  for (const entry of context.inheritedEntries) {
    if (!selected.some((candidate) => candidate.contextEntryId === entry.contextEntryId)) {
      selected.push(entry);
    }
  }
  const normalizedQuery = input.query.normalize("NFKC").toLocaleLowerCase("en-US");
  const queryTerms = new Set([
    normalizedQuery,
    ...(normalizedQuery.match(/[\p{L}\p{N}._/-]+/gu) ?? []),
  ]);
  const queryDigests = new Set(
    [...queryTerms].map((term) => `sha256:${createHash("sha256").update(term).digest("hex")}`),
  );
  const score = (entry: GovernedAgentContextEntry): number => {
    let value = entry.confidence === "high" ? 1 : 0;
    for (const digest of entry.retrievalDigests) if (queryDigests.has(digest)) value += 12;
    return value;
  };
  return selected
    .filter((entry): entry is GovernedAgentContextEntry =>
      hasCompleteGovernedAgentContextMetadata(entry as unknown as Record<string, unknown>),
    )
    .filter(
      (entry) =>
        // A conversation note is self-reported (ADR-0648). It reaches a session only through the
        // room block, which labels it as the agent's own; this document reads as reviewed.
        entry.memoryKind !== "conversation_note" &&
        entry.audience === "agent" &&
        entry.sensitivity === "internal" &&
        (entry.expiresAt === null || Date.parse(entry.expiresAt) > input.at.getTime()),
    )
    .map((entry) => ({ entry, score: score(entry) }))
    .filter((item) => item.score > (item.entry.confidence === "high" ? 1 : 0))
    .sort(
      (left, right) =>
        right.score - left.score ||
        right.entry.observedAt.localeCompare(left.entry.observedAt) ||
        left.entry.contextEntryId.localeCompare(right.entry.contextEntryId),
    )
    .slice(0, maximumEntries)
    .map((item) => item.entry);
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
