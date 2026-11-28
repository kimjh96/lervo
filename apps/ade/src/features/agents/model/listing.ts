import type { ApplicationResults } from "@lervo/session-host-contract";

import { type ApplicationCommands, failureCode } from "../../../ports";
import { useAgentStore } from "./store";

/** How a failed list tries again: the waits before each new try, and how to wait. */
export interface ListRetry {
  readonly delaysMs: readonly number[];
  readonly wait: (ms: number) => Promise<void>;
}

/**
 * Three more tries over about seven seconds. A list can fail for a moment, as it did in the same
 * second a cloned project was registered (2026-11-28), and the same request answered soon after.
 */
const LIST_RETRY: ListRetry = {
  delaysMs: [1_000, 2_000, 4_000],
  wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

type Listed = ApplicationResults["agents.list"];

/**
 * Shows the selected project's agents (Lervo ADE agents, "The sidebar"). The shown list stays
 * until the asked project's arrives, so switching projects crossfades the rows instead of emptying
 * them (ADE craft rules, 13). A failed list tries again after each of the retry's waits, and its
 * failure shows only once the last try failed; asking again, as returning to the project or the
 * next reload does, starts over. Only the latest ask's answer shows.
 */
export async function showProjectAgents(
  commands: ApplicationCommands,
  projectId: string,
  retry: ListRetry = LIST_RETRY,
): Promise<void> {
  const ask = useAgentStore.getState().asks + 1;
  useAgentStore.setState({ asks: ask });
  const current = () => useAgentStore.getState().asks === ask;
  for (let attempt = 0; ; attempt += 1) {
    try {
      const listed = await commands.run("agents.list", { projectId });
      if (current()) showListed(projectId, listed);
      return;
    } catch (failure) {
      if (!current()) return;
      leaveOtherProject(projectId);
      const delay = retry.delaysMs[attempt];
      if (delay === undefined) {
        useAgentStore.setState({ failure: failureCode(failure) });
        return;
      }
      await retry.wait(delay);
      if (!current()) return;
    }
  }
}

/** Shows a project's list. Only a later list of the same project has arrivals, such as a hire. */
function showListed(projectId: string, listed: Listed): void {
  const before = useAgentStore.getState();
  const known = new Set(before.agents.map((agent) => agent.agentId));
  const arrived =
    before.loaded && before.projectId === projectId
      ? new Set(listed.agents.map((agent) => agent.agentId).filter((id) => !known.has(id)))
      : new Set<string>();
  useAgentStore.setState({
    projectId,
    agents: listed.agents,
    roles: listed.roles,
    loaded: true,
    failure: null,
    arrived,
    models: listed.models ?? [],
  });
}

/**
 * Empties a list that belongs to another project once the asked project's list failed, so its
 * agents never show, or join a conversation, under the asked project while it tries again. A
 * failed list of the shown project keeps its agents.
 */
function leaveOtherProject(projectId: string): void {
  if (useAgentStore.getState().projectId === projectId) return;
  useAgentStore.setState({
    projectId,
    agents: [],
    roles: [],
    models: [],
    arrived: new Set(),
    loaded: false,
    failure: null,
  });
}
