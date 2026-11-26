import type { AgentSummary, HireableRole } from "@lervo/session-host-contract";

/** Whether the core link answers the agent commands; an older core shows no agents. */
export const managesAgents = (advertised: readonly string[] | null): boolean =>
  advertised?.includes("agents.list") === true;

/** The project's team: agents the owner or the team hired, in the order they were hired. */
export const teamAgents = (agents: readonly AgentSummary[]): AgentSummary[] =>
  agents.filter((agent) => agent.origin === "team");

/** Lervo's own agents, which maintain repository knowledge. */
export const lervoAgents = (agents: readonly AgentSummary[]): AgentSummary[] =>
  agents.filter((agent) => agent.origin === "lervo");

/** The role "Hire a Product Owner" hires, when the project can hire it. */
export const productOwnerRole = (roles: readonly HireableRole[]): HireableRole | undefined =>
  roles.find((role) => role.roleId === "product-owner");

/** A role's description as one line: its first sentence. */
export function firstSentence(description: string): string {
  const end = description.search(/[.!?](\s|$)/u);
  return end === -1 ? description : description.slice(0, end + 1);
}
