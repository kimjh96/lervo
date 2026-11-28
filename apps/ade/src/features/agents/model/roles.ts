import type { HireableRole } from "@lervo/session-host-contract";

import { type ApplicationCommands, RequestFailure } from "../../../ports";
import { changeAgent, showProjectAgents } from "./controller";
import { useAgentStore } from "./store";

/**
 * Hiring and the project's own roles (Lervo ADE agents, "Hiring" and "Roles"; ADR-0662). Every
 * change is a core command; the agents are listed again once it answers, whether it succeeded or
 * not, and a refusal rejects with the core's code.
 */

/** The sheet the agents show over Lervo: hiring, or one project role's words. */
export type AgentSheet =
  | { readonly kind: "hire"; readonly roleId: string | null }
  | { readonly kind: "role"; readonly roleId: string };

/** The choice in the hire sheet's role menu that adds a role before hiring. */
export const NEW_ROLE = "new-role";

/** Opens the hire sheet on a role, or on a new role when `roleId` is null. */
export function openHireSheet(roleId: string | null): void {
  useAgentStore.setState({ sheet: { kind: "hire", roleId } });
}

/** Opens a project role's sheet, where its words change and it can be removed. */
export function openRoleSheet(roleId: string): void {
  useAgentStore.setState({ sheet: { kind: "role", roleId } });
}

export function closeAgentSheet(): void {
  if (useAgentStore.getState().sheet !== null) useAgentStore.setState({ sheet: null });
}

/** The core's code for a refused change, else the session host's own code. */
export function changeFailureCode(failure: unknown): string {
  if (!(failure instanceof RequestFailure)) return "session_host_unavailable";
  const core = failure.parameters.coreCode;
  return typeof core === "string" ? core : failure.code;
}

/** Whether the project wrote the role itself, so it can be edited and removed. */
export const ownRole = (role: HireableRole | undefined): boolean => role?.source === "repository";

/** A new role's words and the template it starts from. */
export interface NewRole {
  readonly name: string;
  readonly description: string;
  readonly from: string;
}

/** Runs a change, then lists the project's agents and roles again, as they now are. */
async function changeThenList(
  commands: ApplicationCommands,
  projectId: string,
  change: () => Promise<unknown>,
): Promise<void> {
  try {
    await change();
  } finally {
    await showProjectAgents(commands, projectId);
  }
}

/**
 * Hires an agent with a nickname, adding its role first when it is new; `onRoleAdded` hears the
 * new role's ID, so a refused hire tries again with the role it already added.
 */
export async function hireWithRole(
  commands: ApplicationCommands,
  projectId: string,
  hire: { readonly name: string; readonly role: string | NewRole },
  onRoleAdded: (roleId: string) => void = () => undefined,
): Promise<void> {
  await changeThenList(commands, projectId, async () => {
    let roleId: string;
    if (typeof hire.role === "string") roleId = hire.role;
    else {
      roleId = (await commands.run("role.add", { projectId, ...hire.role })).role.roleId;
      onRoleAdded(roleId);
    }
    await commands.run("agent.hire", {
      projectId,
      role: roleId,
      ...(hire.name.trim() === "" ? {} : { name: hire.name.trim() }),
    });
  });
}

/** Changes a project role's name and description; its agents move to the new version. */
export async function editRole(
  commands: ApplicationCommands,
  projectId: string,
  roleId: string,
  words: { readonly name: string; readonly description: string },
): Promise<void> {
  await changeThenList(commands, projectId, () =>
    commands.run("role.edit", { projectId, role: roleId, ...words }),
  );
}

/** Removes a project role no agent holds; the core refuses one that is held. */
export async function removeRole(
  commands: ApplicationCommands,
  projectId: string,
  roleId: string,
): Promise<void> {
  await changeThenList(commands, projectId, () =>
    commands.run("role.remove", { projectId, role: roleId }),
  );
}

/**
 * Moves an agent to another role, keeping its name and what it learned; the profile shows the new
 * role at once (ADE craft rules, 22).
 */
export async function moveAgentRole(
  commands: ApplicationCommands,
  projectId: string,
  agent: { readonly agentId: string; readonly revision: number },
  role: HireableRole,
): Promise<void> {
  await changeAgent(
    commands,
    projectId,
    agent.agentId,
    { roleId: role.roleId, roleName: role.name },
    () =>
      commands.run("agent.role", {
        projectId,
        agentId: agent.agentId,
        revision: agent.revision,
        role: role.roleId,
      }),
  );
}
