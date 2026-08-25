import { resolve } from "node:path";
import { parseArgs } from "node:util";

import { listRoleContracts, resolveRoleContract } from "@lervo/roles";

import type { CliIo } from "./types.js";

export const roleUsage = `  lervo role list [--root <path>] [--json]
  lervo role show --role <role-id> [--root <path>] [--json]
  lervo role validate [--role <role-id>] [--root <path>] [--json]`;

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
      },
    });
    if (parsed.values.help) {
      io.stdout(`${roleUsage}\n`);
      return 0;
    }
    if (parsed.positionals.length !== 1) throw new Error("Specify one role action.");
    const root = resolve(io.cwd, parsed.values.root ?? ".");
    const action = parsed.positionals[0];
    if (action === "list") {
      if (parsed.values.role !== undefined) throw new Error("Role list does not accept --role.");
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
        parsed.values.json
          ? `${JSON.stringify({ schemaVersion: 1, roles }, null, 2)}\n`
          : roles
              .map(
                (role) =>
                  `${role.roleId}@${role.version} · ${role.sourceKind} · ${role.contractHash}`,
              )
              .join("\n")
              .concat("\n"),
      );
      return 0;
    }
    if (action === "show") {
      if (parsed.values.role === undefined) throw new Error("Role show requires --role.");
      const contract = await resolveRoleContract(root, parsed.values.role);
      io.stdout(
        parsed.values.json
          ? `${JSON.stringify(contract, null, 2)}\n`
          : `${contract.roleId}@${contract.version}\ncontract: ${contract.contractHash}\nprofile: ${contract.definition.evaluation.roleProfileHash}\nsource: ${contract.sourceKind}${contract.sourcePath === null ? "" : ` (${contract.sourcePath})`}\n`,
      );
      return 0;
    }
    if (action === "validate") {
      const contracts =
        parsed.values.role === undefined
          ? await listRoleContracts(root)
          : [await resolveRoleContract(root, parsed.values.role)];
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
        parsed.values.json
          ? `${JSON.stringify(result, null, 2)}\n`
          : `Validated ${contracts.length} role contract${contracts.length === 1 ? "" : "s"}.\n`,
      );
      return 0;
    }
    throw new Error("The role action is invalid.");
  } catch (error) {
    io.stderr(
      `Role command failed: ${error instanceof Error ? error.message : String(error)}\n${roleUsage}\n`,
    );
    return 1;
  }
}
