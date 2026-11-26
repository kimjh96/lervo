import type { AgentSummary, HireableRole } from "@lervo/session-host-contract";
import { create } from "zustand";

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
}

export const useAgentStore = create<AgentState>(() => ({
  projectId: null,
  requested: null,
  agents: [],
  roles: [],
  loaded: false,
  failure: null,
  arrived: new Set(),
}));
