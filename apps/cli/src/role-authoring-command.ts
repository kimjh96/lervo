// `lervo role add|edit|remove` (ADR-0662): the flags of a project role change, parsed and handed
// to `project-roles.ts`, which owns the change.
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import type { ResolvedRoleContract } from "@lervo/roles";

import { commandActor } from "./organization-authority.js";
import { addProjectRole, editProjectRole, removeProjectRole } from "./project-roles.js";
import type { CliIo } from "./types.js";

export const roleAuthoringUsage = `  lervo role add --name <name> --description <text> --from <role-id> [--role <role-id>] [--request-types <type,...>] [--capability <permission>=<allow|deny|require_approval>] --write [--root <path>] [--json]
  lervo role add --source <file> --write [--root <path>] [--json]
  lervo role edit --role <role-id> [--name <name>] [--description <text>] [--request-types <type,...>] --write [--root <path>] [--json]
  lervo role remove --role <role-id> --write [--root <path>] [--json]`;

/** The flags `lervo role` reads beyond `--role`, `--root`, and `--json`. */
export const roleAuthoringOptions = {
  write: { type: "boolean" },
  name: { type: "string" },
  description: { type: "string" },
  from: { type: "string" },
  source: { type: "string" },
  "request-types": { type: "string" },
  capability: { type: "string", multiple: true },
} as const;

export interface RoleValues {
  root?: string;
  role?: string;
  json?: boolean;
  write?: boolean;
  name?: string;
  description?: string;
  from?: string;
  source?: string;
  "request-types"?: string;
  capability?: string[];
}

const PERMISSION_DECISIONS = new Set(["allow", "deny", "require_approval"]);

/** `a,b` as request types; an empty value clears those the role added. */
function requestTypes(value: string | undefined): string[] | undefined {
  if (value === undefined) return undefined;
  return value
    .split(",")
    .map((type) => type.trim())
    .filter((type) => type.length > 0);
}

/** `permission=decision` pairs as the capabilities a new role narrows. */
function capabilities(values: readonly string[] | undefined) {
  if (values === undefined) return undefined;
  return Object.fromEntries(
    values.map((pair) => {
      const [permission, decision] = pair.split("=");
      if (permission === undefined || decision === undefined || !PERMISSION_DECISIONS.has(decision))
        throw new Error(
          `The capability ${pair} is not <permission>=<allow|deny|require_approval>.`,
        );
      return [permission, decision];
    }),
  );
}

function summary(contract: ResolvedRoleContract) {
  return {
    roleId: contract.roleId,
    name: contract.definition.profile.name,
    description: contract.definition.profile.description,
    version: contract.version,
    contractHash: contract.contractHash,
    requestTypes: contract.definition.profile.requestTypes,
    extends: contract.extends,
  };
}

function print(io: CliIo, json: boolean | undefined, value: unknown, message: string): void {
  io.stdout(json ? `${JSON.stringify(value, null, 2)}\n` : `${message}\n`);
}

/** Adds a project role from a template, or from a complete source file. */
async function addAction(values: RoleValues, root: string, io: CliIo): Promise<void> {
  if (!values.write) throw new Error("Role add requires --write.");
  const addition =
    values.source !== undefined
      ? { source: JSON.parse(await readFile(resolve(io.cwd, values.source), "utf8")) as unknown }
      : {
          ...(values.role === undefined ? {} : { roleId: values.role }),
          name: values.name ?? "",
          description: values.description ?? "",
          from: values.from ?? "",
          ...(values["request-types"] === undefined
            ? {}
            : { requestTypes: requestTypes(values["request-types"])! }),
          ...(values.capability === undefined
            ? {}
            : { capabilities: capabilities(values.capability)! }),
        };
  if (!("source" in addition) && (addition.name === "" || addition.from === ""))
    throw new Error("Role add requires --name, --description, and --from, or --source.");
  const contract = await addProjectRole(root, addition, commandActor());
  print(
    io,
    values.json,
    { schemaVersion: 1, role: summary(contract) },
    `Added role ${contract.definition.profile.name} (${contract.roleId}@${contract.version}).`,
  );
}

/** Edits a project role's words or added request types at its next version. */
async function editAction(values: RoleValues, root: string, io: CliIo): Promise<void> {
  if (!values.write || values.role === undefined)
    throw new Error("Role edit requires --role and --write.");
  const types = requestTypes(values["request-types"]);
  const { contract, changed } = await editProjectRole(
    root,
    values.role,
    {
      ...(values.name === undefined ? {} : { name: values.name }),
      ...(values.description === undefined ? {} : { description: values.description }),
      ...(types === undefined ? {} : { requestTypes: types }),
    },
    commandActor(),
  );
  print(
    io,
    values.json,
    { schemaVersion: 1, changed, role: summary(contract) },
    changed
      ? `Role ${contract.roleId} is now version ${contract.version}; its agents moved with it.`
      : `Role ${contract.roleId} is unchanged at version ${contract.version}.`,
  );
}

/** Removes a project role that no agent or open assignment holds. */
async function removeAction(values: RoleValues, root: string, io: CliIo): Promise<void> {
  if (!values.write || values.role === undefined)
    throw new Error("Role remove requires --role and --write.");
  const removed = await removeProjectRole(root, values.role, commandActor());
  print(
    io,
    values.json,
    { schemaVersion: 1, removed },
    `Removed role ${removed.roleId}@${removed.version}.`,
  );
}

export const roleAuthoringActions = { add: addAction, edit: editAction, remove: removeAction };
