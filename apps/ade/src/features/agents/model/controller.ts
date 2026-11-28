import type { AgentSummary } from "@lervo/session-host-contract";

import { type ApplicationCommands, failureCode } from "../../../ports";
import { showProjectAgents } from "./listing";
import { useAgentStore } from "./store";

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
