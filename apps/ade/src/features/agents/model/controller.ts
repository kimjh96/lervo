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
    models: listed.models ?? [],
  });
}

/** Renames an agent in place, then lists the project's agents again; rejects with the failure. */
export async function renameAgent(
  commands: ApplicationCommands,
  projectId: string,
  agent: { agentId: string; revision: number },
  name: string,
): Promise<void> {
  await commands.run("agent.rename", {
    projectId,
    agentId: agent.agentId,
    revision: agent.revision,
    name,
  });
  await showProjectAgents(commands, projectId);
}

/** Sets the model and effort an agent's next sessions run with (ADR-0647); rejects on failure. */
export async function setAgentModel(
  commands: ApplicationCommands,
  projectId: string,
  agent: { agentId: string; revision: number },
  model: { tier: string; effort: string },
): Promise<void> {
  await commands.run("agent.model", {
    projectId,
    agentId: agent.agentId,
    revision: agent.revision,
    tier: model.tier,
    effort: model.effort,
  });
  await showProjectAgents(commands, projectId);
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
