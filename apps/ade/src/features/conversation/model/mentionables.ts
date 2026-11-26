import type { AgentSummary } from "@lervo/session-host-contract";

import { teamAgents } from "../../agents/model";

/** An agent the owner can mention: one in the conversation, or one of the team who would join. */
export interface Mentionable {
  readonly agentId: string;
  readonly displayName: string;
  readonly roleName: string;
  readonly participant: boolean;
}

/**
 * The agents the reply card's `@` offers (Lervo ADE rooms, "Mentions"): the conversation's agents
 * first, then the rest of the team, each in the order the team hired them. Lervo's own agents are
 * never offered.
 */
export function mentionablesOf(
  agents: readonly AgentSummary[],
  participants: readonly string[],
): Mentionable[] {
  const team = teamAgents(agents);
  const of = (participant: boolean) =>
    team
      .filter((agent) => participants.includes(agent.agentId) === participant)
      .map((agent) => ({
        agentId: agent.agentId,
        displayName: agent.displayName,
        roleName: agent.roleName,
        participant,
      }));
  return [...of(true), ...of(false)];
}
