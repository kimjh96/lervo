import type { AgentModelChoice, AgentSummary, HireableRole } from "@lervo/session-host-contract";
import { create } from "zustand";

import { useWorkspaceStore } from "../../workspaces/model";
import type { Learned } from "./learned";

/** The selected project's agents and the roles it can hire (Lervo ADE agents, "The sidebar"). */
export interface AgentState {
  /** The project the shown list belongs to; null before the first list arrives. */
  readonly projectId: string | null;
  /** The project whose list was asked for last; an older answer is dropped. */
  readonly requested: string | null;
  readonly agents: readonly AgentSummary[];
  readonly roles: readonly HireableRole[];
  /** Whether the project's list arrived once. */
  readonly loaded: boolean;
  /** The failure code of the last list or hire, or null. */
  readonly failure: string | null;
  /** Agents that arrived in the latest list of the same project, such as one just hired. */
  readonly arrived: ReadonlySet<string>;
  /** The models a team agent can run on, most capable first (ADR-0647). */
  readonly models: readonly AgentModelChoice[];
  /** The agent whose profile the main area shows, or null. */
  readonly profile: string | null;
  /** What the profile's agent has learned, as the core last answered. */
  readonly learned: Learned | null;
}

export const useAgentStore = create<AgentState>(() => ({
  projectId: null,
  requested: null,
  agents: [],
  roles: [],
  loaded: false,
  failure: null,
  arrived: new Set(),
  models: [],
  profile: null,
  learned: null,
}));

/** Shows an agent's profile in the main area, in place of a conversation or the start screen. */
export function openProfile(agentId: string): void {
  useWorkspaceStore.getState().select(null);
  useAgentStore.setState({ profile: agentId });
}

/**
 * Closes the profile when the person turns elsewhere: to a conversation, to new work, or to
 * another project's agents. Returns the unsubscribe function.
 */
export function bindProfile(): () => void {
  const workspaces = useWorkspaceStore.subscribe((state, previous) => {
    if (
      (state.selected !== null && state.selected !== previous.selected) ||
      state.newWorkRequests !== previous.newWorkRequests
    )
      closeProfile();
  });
  const agents = useAgentStore.subscribe((state, previous) => {
    if (state.projectId !== previous.projectId) closeProfile();
  });
  return () => {
    workspaces();
    agents();
  };
}

/** Closes the profile, as choosing a conversation, new work, or another project does. */
export function closeProfile(): void {
  if (useAgentStore.getState().profile !== null) useAgentStore.setState({ profile: null });
}
