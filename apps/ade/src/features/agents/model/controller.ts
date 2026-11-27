import type { AgentSummary } from "@lervo/session-host-contract";

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

/**
 * Changes an agent (ADE craft rules, 22): the shown agent takes the change before the core
 * answers, so a renamed agent never shows its old name again, and the project's agents are listed
 * again once it answers. A refusal lists them again too, which shows the agent as it was, and
 * rejects with the failure.
 */
export async function changeAgent(
  commands: ApplicationCommands,
  projectId: string,
  agentId: string,
  shown: Partial<AgentSummary>,
  change: () => Promise<unknown>,
): Promise<void> {
  const before = useAgentStore.getState();
  if (before.projectId === projectId)
    useAgentStore.setState({
      agents: before.agents.map((item) =>
        item.agentId === agentId ? { ...item, ...shown } : item,
      ),
    });
  try {
    await change();
  } finally {
    await showProjectAgents(commands, projectId);
  }
}

/** Renames an agent in place; rejects with the failure. */
export async function renameAgent(
  commands: ApplicationCommands,
  projectId: string,
  agent: { agentId: string; revision: number },
  name: string,
): Promise<void> {
  await changeAgent(commands, projectId, agent.agentId, { displayName: name }, () =>
    commands.run("agent.rename", {
      projectId,
      agentId: agent.agentId,
      revision: agent.revision,
      name,
    }),
  );
}

/** Sets the model and effort an agent's next sessions run with (ADR-0647); rejects on failure. */
export async function setAgentModel(
  commands: ApplicationCommands,
  projectId: string,
  agent: { agentId: string; revision: number; model?: AgentSummary["model"] },
  model: { tier: string; effort: string },
): Promise<void> {
  const current = agent.model;
  const shown =
    current === undefined
      ? {}
      : {
          model: {
            ...current,
            tier: model.tier as typeof current.tier,
            effort: model.effort as typeof current.effort,
          },
        };
  await changeAgent(commands, projectId, agent.agentId, shown, () =>
    commands.run("agent.model", {
      projectId,
      agentId: agent.agentId,
      revision: agent.revision,
      tier: model.tier,
      effort: model.effort,
    }),
  );
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

/** Pauses an agent or lets it work again; rejects on failure. */
export async function setAgentStatus(
  commands: ApplicationCommands,
  projectId: string,
  agent: { agentId: string; revision: number },
  status: "active" | "suspended",
): Promise<void> {
  await changeAgent(commands, projectId, agent.agentId, { status }, () =>
    commands.run("agent.status", {
      projectId,
      agentId: agent.agentId,
      revision: agent.revision,
      status,
    }),
  );
}
