import type { AgentSummary, HireableRole } from "@lervo/session-host-contract";

import { visibleStatus, type Workspace } from "../../workspaces";

/** Whether the core link answers the agent commands; an older core shows no agents. */
export const managesAgents = (advertised: readonly string[] | null): boolean =>
  advertised?.includes("agents.list") === true;

/** The project's team: agents the owner or the team hired, in the order they were hired. */
export const teamAgents = (agents: readonly AgentSummary[]): AgentSummary[] =>
  agents.filter((agent) => agent.origin === "team");

/** The role "Hire a Product Owner" hires, when the project can hire it. */
export const productOwnerRole = (roles: readonly HireableRole[]): HireableRole | undefined =>
  roles.find((role) => role.roleId === "product-owner");

/** A role's description as one line: its first sentence. */
export function firstSentence(description: string): string {
  const end = description.search(/[.!?](\s|$)/u);
  return end === -1 ? description : description.slice(0, end + 1);
}

/**
 * The participants a new conversation starts with when the person chose none: the product owner,
 * or else the first team agent, or none in a project without agents (Lervo ADE agents,
 * "Participants and sessions").
 */
export function defaultParticipants(team: readonly AgentSummary[]): string[] {
  const owner = team.find((agent) => agent.roleId === "product-owner") ?? team[0];
  return owner === undefined ? [] : [owner.agentId];
}

/** The chosen participants with one toggled; the last one stays, since a conversation needs one. */
export function toggleParticipant(chosen: readonly string[], agentId: string): string[] {
  if (!chosen.includes(agentId)) return [...chosen, agentId];
  return chosen.length === 1 ? [...chosen] : chosen.filter((id) => id !== agentId);
}

/** Whether the core takes a new conversation's participants. */
export const takesParticipants = (advertised: readonly string[] | null): boolean =>
  advertised?.includes("workspace.participants") === true;

/**
 * What an agent is doing, from the conversations whose session is its own: needs the owner when
 * any of them does, working when any works, and nothing otherwise (Lervo ADE agents, "The
 * sidebar").
 */
export function agentActivity(
  agentId: string,
  workspaces: readonly Workspace[],
  statuses: Readonly<Record<string, Parameters<typeof visibleStatus>[0]>>,
): "working" | "needsYou" | null {
  let activity: "working" | "needsYou" | null = null;
  for (const workspace of workspaces) {
    if (workspace.agentId !== agentId) continue;
    // Statuses are kept by session, as the workspace list reads them.
    const status = visibleStatus(statuses[workspace.sessionId]);
    if (status === "needsYou") return "needsYou";
    if (status === "working") activity = "working";
  }
  return activity;
}
