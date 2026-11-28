import { resolve } from "node:path";
import { parseArgs } from "node:util";

import { listRoleContracts, resolveRoleContract } from "@lervo/roles";

import {
  roleAuthoringActions,
  roleAuthoringOptions,
  roleAuthoringUsage,
  type RoleValues,
} from "./role-authoring-command.js";
import type { CliIo } from "./types.js";

export const roleUsage = `  lervo role list [--root <path>] [--json]
  lervo role show --role <role-id> [--root <path>] [--json]
  lervo role validate [--role <role-id>] [--root <path>] [--json]
${roleAuthoringUsage}`;

/** One `lervo role` action: what it does with the flags, in the repository at `root`. */
type RoleAction = (values: RoleValues, root: string, io: CliIo) => Promise<void>;

/** Lists every role the repository resolves, built-in and its own. */
async function listAction(values: RoleValues, root: string, io: CliIo): Promise<void> {
  if (values.role !== undefined) throw new Error("Role list does not accept --role.");
  const roles = (await listRoleContracts(root)).map((contract) => ({
    roleId: contract.roleId,
    name: contract.definition.profile.name,
    version: contract.version,
    contractHash: contract.contractHash,
    profileHash: contract.definition.evaluation.roleProfileHash,
    sourceKind: contract.sourceKind,
    sourcePath: contract.sourcePath,
    extends: contract.extends,
  }));
  io.stdout(
    values.json
      ? `${JSON.stringify({ schemaVersion: 1, roles }, null, 2)}\n`
      : roles
          .map(
            (role) => `${role.roleId}@${role.version} · ${role.sourceKind} · ${role.contractHash}`,
          )
          .join("\n")
          .concat("\n"),
  );
}

/** Shows one role's resolved contract. */
async function showAction(values: RoleValues, root: string, io: CliIo): Promise<void> {
  if (values.role === undefined) throw new Error("Role show requires --role.");
  const contract = await resolveRoleContract(root, values.role);
  io.stdout(
    values.json
      ? `${JSON.stringify(contract, null, 2)}\n`
      : `${contract.roleId}@${contract.version}\ncontract: ${contract.contractHash}\nprofile: ${contract.definition.evaluation.roleProfileHash}\nsource: ${contract.sourceKind}${contract.sourcePath === null ? "" : ` (${contract.sourcePath})`}\n`,
  );
}

/** Resolves one role, or every role, and reports their hashes. */
async function validateAction(values: RoleValues, root: string, io: CliIo): Promise<void> {
  const contracts =
    values.role === undefined
      ? await listRoleContracts(root)
      : [await resolveRoleContract(root, values.role)];
  const result = {
    schemaVersion: 1,
    valid: true,
    roles: contracts.map((contract) => ({
      roleId: contract.roleId,
      version: contract.version,
      contractHash: contract.contractHash,
    })),
  };
  io.stdout(
    values.json
      ? `${JSON.stringify(result, null, 2)}\n`
      : `Validated ${contracts.length} role contract${contracts.length === 1 ? "" : "s"}.\n`,
  );
}

const roleActions: Readonly<Record<string, RoleAction>> = {
  list: listAction,
  show: showAction,
  validate: validateAction,
  ...roleAuthoringActions,
};

export async function runRoleCommand(args: string[], io: CliIo): Promise<number> {
  try {
    const parsed = parseArgs({
      args,
      strict: true,
      allowPositionals: true,
      options: {
        root: { type: "string" },
        role: { type: "string" },
        json: { type: "boolean" },
        help: { type: "boolean", short: "h" },
        ...roleAuthoringOptions,
      },
    });
    if (parsed.values.help) {
      io.stdout(`${roleUsage}\n`);
      return 0;
    }
    if (parsed.positionals.length !== 1) throw new Error("Specify one role action.");
    const action = roleActions[parsed.positionals[0]!];
    if (action === undefined || !Object.hasOwn(roleActions, parsed.positionals[0]!))
      throw new Error("The role action is invalid.");
    await action(parsed.values, resolve(io.cwd, parsed.values.root ?? "."), io);
    return 0;
  } catch (error) {
    const code =
      error !== null &&
      typeof error === "object" &&
      "code" in error &&
      typeof error.code === "string"
        ? ` (${error.code})`
        : "";
    io.stderr(
      `Role command failed${code}: ${error instanceof Error ? error.message : String(error)}\n${roleUsage}\n`,
    );
    return 1;
  }
}
