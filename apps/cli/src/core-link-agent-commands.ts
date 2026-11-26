import {
  AgentWorkforceError,
  agentModel,
  changeAgentModel,
  listAgents,
  modelEfforts,
  modelTiers,
  type ModelEffort,
  type ModelTier,
  type WorkforceAgent,
} from "@lervo/agent-workforce";
import { lervoAgentIds, loadConvergenceDelegation } from "@lervo/repository-knowledge-runtime";
import { RoleContractError } from "@lervo/roles";
import { RepositoryRegistryError } from "@lervo/repository-registry";

import { hireAgent } from "./agent-hire.js";
import { hostedProviderModels } from "./hosted-session-adapters.js";
import { mutateWorkforceState } from "./workforce-mutation.js";
import { CommandFailure } from "./command-error-output.js";
import { locateProject } from "./project-service.js";
import { roleCatalog } from "./role-catalog.js";

/**
 * The agent commands of the core link (Lervo ADE agents, "Core link"): a project's agents with
 * whether each is the team's or Lervo's own, the roles it can hire, hiring for the owner, and the
 * model and effort a team agent runs with (ADR-0647).
 */
export const coreLinkAgentCommands = new Set(["agents.list", "agent.hire", "agent.model"]);

function oneOf<T extends string>(
  arguments_: Record<string, unknown>,
  name: string,
  values: readonly T[],
): T {
  const value = arguments_[name];
  if (typeof value !== "string" || !(values as readonly string[]).includes(value))
    throw new CommandFailure("agent_argument_invalid", `${name} is one of ${values.join(", ")}.`);
  return value as T;
}

function text(arguments_: Record<string, unknown>, name: string, maximum: number): string {
  const value = arguments_[name];
  if (typeof value !== "string" || value.length === 0 || value.length > maximum)
    throw new CommandFailure("agent_argument_missing", `${name} is required.`);
  return value;
}

/** The convergence delegation, or null when the project has none or it cannot be read. */
async function delegationOf(root: string) {
  return (await loadConvergenceDelegation(root).catch(() => null))?.delegation ?? null;
}

function view(agent: WorkforceAgent, roleNames: Map<string, string>, lervos: Set<string>) {
  return {
    agentId: agent.agentId,
    displayName: agent.displayName,
    roleId: agent.roleId,
    roleName: roleNames.get(agent.roleId) ?? agent.roleId,
    status: agent.status,
    // A recorded origin decides; a record from before it falls back to ADR-0643's rule.
    origin: agent.origin ?? (lervos.has(agent.agentId) ? "lervo" : "team"),
    provider: agent.provider,
    parentAgentId: agent.parentAgentId,
    revision: agent.revision,
    ...(agent.origin === "lervo" || lervos.has(agent.agentId) ? {} : { model: modelView(agent) }),
  };
}

/** A team agent's model, with the name its provider gives the tier's model. */
function modelView(agent: WorkforceAgent) {
  const chosen = agentModel(agent);
  const named = hostedProviderModels(agent.provider)?.[chosen.tier].displayName;
  return { ...chosen, ...(named === undefined ? {} : { displayName: named }) };
}

async function answer(command: string, arguments_: Record<string, unknown>): Promise<object> {
  const projectId = text(arguments_, "projectId", 64);
  const { root } = await locateProject(projectId);
  const { roles, names } = await roleCatalog(root);
  if (command === "agents.list") {
    // The sidebar lists agents in the order they were hired.
    const agents = (await listAgents(root, { readOnly: true }))
      .filter((agent) => agent.status !== "retired")
      .toSorted((left, right) => left.createdAt.localeCompare(right.createdAt));
    const lervos = lervoAgentIds(agents, await delegationOf(root));
    return { projectId, agents: agents.map((agent) => view(agent, names, lervos)), roles };
  }
  if (command === "agent.model") {
    const revision = arguments_.revision;
    if (!Number.isSafeInteger(revision) || (revision as number) < 1)
      throw new CommandFailure("agent_argument_invalid", "revision is the agent's revision.");
    const agentId = text(arguments_, "agentId", 64);
    const tier = oneOf<ModelTier>(arguments_, "tier", modelTiers);
    const effort = oneOf<ModelEffort>(arguments_, "effort", modelEfforts);
    const agent = await mutateWorkforceState(root, (recordEvent) =>
      changeAgentModel({
        repositoryRoot: root,
        agentId,
        expectedRevision: revision as number,
        tier,
        effort,
        recordEvent,
      }),
    );
    return { projectId, agent: view(agent, names, new Set()) };
  }
  const name = arguments_.name === undefined ? undefined : text(arguments_, "name", 40);
  const agent = await hireAgent(root, {
    roleId: text(arguments_, "role", 64),
    // ADE sessions run Claude Code (ADR-0617), so the agents it hires do too.
    provider: "claude",
    ...(name === undefined ? {} : { displayName: name }),
    responsibilityPaths: ["*"],
  });
  return { projectId, agent: view(agent, names, new Set()) };
}

/** Answers one agent command, with each failure under its own stable code. */
export async function runCoreLinkAgentCommand(
  command: string,
  arguments_: Record<string, unknown>,
): Promise<object> {
  try {
    return await answer(command, arguments_);
  } catch (error) {
    if (
      error instanceof AgentWorkforceError ||
      error instanceof RoleContractError ||
      error instanceof RepositoryRegistryError
    )
      throw new CommandFailure(error.code, error.message);
    throw error;
  }
}
