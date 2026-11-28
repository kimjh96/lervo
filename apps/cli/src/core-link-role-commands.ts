// The role commands of the core link (Lervo ADE agents, "Roles"; ADR-0662): adding, editing, and
// removing a project's own roles for the owner, as `lervo role add|edit|remove` does.
import type { ResolvedRoleContract } from "@lervo/roles";

import { CommandFailure } from "./command-error-output.js";
import { addProjectRole, editProjectRole, removeProjectRole } from "./project-roles.js";

export const coreLinkRoleCommands: ReadonlySet<string> = new Set([
  "role.add",
  "role.edit",
  "role.remove",
]);

function text(
  arguments_: Record<string, unknown>,
  name: string,
  maximum: number,
): string | undefined {
  const value = arguments_[name];
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.trim().length === 0 || value.length > maximum)
    throw new CommandFailure("role_argument_invalid", `${name} is 1 to ${maximum} characters.`);
  return value;
}

function required(arguments_: Record<string, unknown>, name: string, maximum: number): string {
  const value = text(arguments_, name, maximum);
  if (value === undefined)
    throw new CommandFailure("role_argument_missing", `${name} is required.`);
  return value;
}

/** A role as the hire menu lists it. */
function hireable(contract: ResolvedRoleContract) {
  return {
    roleId: contract.roleId,
    name: contract.definition.profile.name,
    description: contract.definition.profile.description,
    source: contract.sourceKind,
  };
}

/**
 * Answers one role command for the owner of the project at `root`. The ADE runs for the owner, so
 * no agent's authority is consulted.
 */
export async function runCoreLinkRoleCommand(
  root: string,
  projectId: string,
  command: string,
  arguments_: Record<string, unknown>,
): Promise<object> {
  if (command === "role.add") {
    const roleId = text(arguments_, "role", 64);
    const contract = await addProjectRole(
      root,
      {
        ...(roleId === undefined ? {} : { roleId }),
        name: required(arguments_, "name", 100),
        description: required(arguments_, "description", 1000),
        from: required(arguments_, "from", 64),
      },
      undefined,
    );
    return { projectId, role: hireable(contract) };
  }
  const roleId = required(arguments_, "role", 64);
  if (command === "role.remove") {
    const removed = await removeProjectRole(root, roleId, undefined);
    return { projectId, roleId: removed.roleId };
  }
  const name = text(arguments_, "name", 100);
  const description = text(arguments_, "description", 1000);
  const { contract, changed } = await editProjectRole(
    root,
    roleId,
    {
      ...(name === undefined ? {} : { name }),
      ...(description === undefined ? {} : { description }),
    },
    undefined,
  );
  return { projectId, role: hireable(contract), changed };
}
