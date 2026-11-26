import { AgentWorkforceError, listAgents, type WorkforceAgent } from "@lervo/agent-workforce";
import { lervoAgentIds, loadConvergenceDelegation } from "@lervo/repository-knowledge-runtime";
import { listRoleContracts, listRoleTemplates, RoleContractError } from "@lervo/roles";
import { RepositoryRegistryError } from "@lervo/repository-registry";

import { hireAgent } from "./agent-hire.js";
import { CommandFailure } from "./command-error-output.js";
import { locateProject } from "./project-service.js";

/**
 * The agent commands of the core link (Lervo ADE agents, "Core link"): a project's agents with
 * whether each is the team's or Lervo's own, the roles it can hire, and hiring for the owner.
 */
export const coreLinkAgentCommands = new Set(["agents.list", "agent.hire"]);

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
  };
}

async function roleCatalog(root: string) {
  const roles: { roleId: string; name: string; description: string; source: string }[] = (
    await listRoleContracts(root)
  ).map((role) => ({
    roleId: role.roleId,
    name: role.definition.profile.name,
    description: role.definition.profile.description,
    source: role.sourceKind,
  }));
  // A template role, such as the product owner, can be hired before the project has it: hiring
  // writes it (Lervo ADE projects, "The product-owner role template").
  for (const template of listRoleTemplates())
    if (!roles.some((role) => role.roleId === template.roleId))
      roles.push({ ...template, source: "repository" });
  return { roles, names: new Map(roles.map((role) => [role.roleId, role.name])) };
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
