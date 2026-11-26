// What an agent has learned, as its profile shows it (Lervo ADE agents, "The profile").
import type { AgentContextResult } from "@lervo/session-host-contract";

import { type ApplicationCommands, failureCode } from "../../../ports";
import { useAgentStore } from "./store";

export type LearnedEntry = AgentContextResult["entries"][number];

/** One agent's learned entries: null while the core reads them, or the failure's code. */
export interface Learned {
  readonly agentId: string;
  readonly entries: readonly LearnedEntry[] | null;
  readonly failure: string | null;
}

/**
 * Reads what the agent has learned through the core's `agent.context`. A reread of the same agent
 * keeps the entries shown until the answer arrives, and an answer for an agent the profile left
 * is dropped.
 */
export async function loadLearned(
  commands: ApplicationCommands,
  projectId: string,
  agentId: string,
): Promise<void> {
  const shown = useAgentStore.getState().learned;
  useAgentStore.setState({
    learned: { agentId, entries: shown?.agentId === agentId ? shown.entries : null, failure: null },
  });
  const current = () => useAgentStore.getState().learned?.agentId === agentId;
  try {
    const { entries } = await commands.run("agent.context", { projectId, agentId });
    if (current()) useAgentStore.setState({ learned: { agentId, entries, failure: null } });
  } catch (failure) {
    if (current())
      useAgentStore.setState({
        learned: { agentId, entries: null, failure: failureCode(failure) },
      });
  }
}
