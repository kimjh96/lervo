import { type ApplicationCommands, failureCode } from "../../../ports";
import { useAgentStore } from "./store";

/**
 * Shows the selected project's agents. The shown list stays until the asked project's arrives, so
 * switching projects crossfades the rows instead of emptying them (ADE craft rules, 13).
 */
export async function showProjectAgents(
  commands: ApplicationCommands,
  projectId: string,
): Promise<void> {
  useAgentStore.setState({ requested: projectId });
  let listed: Awaited<ReturnType<typeof commands.run<"agents.list">>>;
  try {
    listed = await commands.run("agents.list", { projectId });
  } catch (failure) {
    if (useAgentStore.getState().requested === projectId)
      useAgentStore.setState({ failure: failureCode(failure) });
    return;
  }
  const before = useAgentStore.getState();
  // A list that arrives after the person switched projects is dropped.
  if (before.requested !== projectId) return;
  // Only a later list of the same project has arrivals, such as an agent just hired.
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
  });
}

/** Hires an agent of the role for the owner, then lists the project's agents again. */
export async function hireAgent(
  commands: ApplicationCommands,
  projectId: string,
  roleId: string,
): Promise<void> {
  useAgentStore.setState({ failure: null });
  try {
    await commands.run("agent.hire", { projectId, role: roleId });
  } catch (failure) {
    useAgentStore.setState({ failure: failureCode(failure) });
    return;
  }
  await showProjectAgents(commands, projectId);
}
