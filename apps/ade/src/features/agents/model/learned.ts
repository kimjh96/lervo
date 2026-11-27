// What an agent has learned and the paths it holds, as its profile shows them (Lervo ADE agents,
// "The profile").
import type { AgentContextResult } from "@lervo/session-host-contract";

import { type ApplicationCommands, failureCode } from "../../../ports";
import { useAgentStore } from "./store";

export type LearnedEntry = AgentContextResult["entries"][number];

/** The paths an agent holds under a live write lease: the first ones, sorted, and how many. */
export interface Held {
  readonly paths: readonly string[];
  readonly total: number;
}

/**
 * One agent's learned entries and paths: null while the core reads them, or the failure's code.
 * `held` stays null from a core that does not read leases, and `changed`, the paths its
 * conversations changed and have not sealed, from one that does not record them.
 */
export interface Learned {
  readonly agentId: string;
  readonly entries: readonly LearnedEntry[] | null;
  readonly held: Held | null;
  readonly changed: Held | null;
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
  const same = shown?.agentId === agentId;
  useAgentStore.setState({
    learned: {
      agentId,
      entries: same ? shown.entries : null,
      held: same ? shown.held : null,
      changed: same ? shown.changed : null,
      failure: null,
    },
  });
  const current = () => useAgentStore.getState().learned?.agentId === agentId;
  try {
    const answer = await commands.run("agent.context", { projectId, agentId });
    const held =
      answer.paths === undefined
        ? null
        : { paths: answer.paths, total: answer.pathsTotal ?? answer.paths.length };
    const changed =
      answer.changedPaths === undefined
        ? null
        : {
            paths: answer.changedPaths,
            total: answer.changedPathsTotal ?? answer.changedPaths.length,
          };
    if (current())
      useAgentStore.setState({
        learned: { agentId, entries: answer.entries, held, changed, failure: null },
      });
  } catch (failure) {
    if (current())
      useAgentStore.setState({
        learned: {
          agentId,
          entries: null,
          held: null,
          changed: null,
          failure: failureCode(failure),
        },
      });
  }
}
