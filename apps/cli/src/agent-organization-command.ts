import { resolve } from "node:path";
import { parseArgs } from "node:util";

import { loadNodeRuntimeConfig } from "@lervo/node-runtime";

import {
  bindAgentOrganizationRuntime,
  inspectAgentOrganization,
} from "./agent-organization-runtime-binding.js";
import type { CliIo } from "./types.js";

export const agentOrganizationUsage = [
  "  lervo organization inspect [--root <path>] [--json]",
  "  lervo organization bind-runtime --organization <id> --team <id> --config <node-config> --write [--root <path>] [--json]",
].join("\n");

function identifier(value: string | undefined, kind: "organization" | "team"): string {
  const pattern =
    kind === "organization"
      ? /^org_[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/u
      : /^team_[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/u;
  if (value === undefined || !pattern.test(value)) {
    throw new Error(`The ${kind} ID is invalid.`);
  }
  return value;
}

export async function runAgentOrganizationCommand(args: string[], io: CliIo): Promise<number> {
  const parsed = parseArgs({
    args,
    strict: true,
    allowPositionals: true,
    options: {
      root: { type: "string" },
      json: { type: "boolean" },
      write: { type: "boolean" },
      help: { type: "boolean", short: "h" },
      organization: { type: "string" },
      team: { type: "string" },
      config: { type: "string" },
    },
  });
  if (parsed.values.help) {
    io.stdout(`${agentOrganizationUsage}\n`);
    return 0;
  }
  if (parsed.positionals.length !== 1) throw new Error("The organization action is invalid.");
  const action = parsed.positionals[0];
  const root = resolve(io.cwd, parsed.values.root ?? ".");
  if (action === "inspect") {
    if (parsed.values.write) throw new Error("Organization inspection is read-only.");
    const current = await inspectAgentOrganization(root);
    io.stdout(
      parsed.values.json
        ? `${JSON.stringify(current, null, 2)}\n`
        : `${current.team === null ? "No organization team binding." : `${current.team.organizationId} · ${current.team.teamId} · ${current.memberships.length} agents · ${current.deployments.length} deployments`}\n`,
    );
    return 0;
  }
  if (action !== "bind-runtime" || !parsed.values.write || parsed.values.config === undefined) {
    throw new Error("Organization runtime binding requires exact IDs, --config, and --write.");
  }
  const organizationId = identifier(parsed.values.organization, "organization");
  const teamId = identifier(parsed.values.team, "team");
  const config = await loadNodeRuntimeConfig(resolve(io.cwd, parsed.values.config));
  if (resolve(config.repositoryRoot) !== root) {
    throw new Error("The Node configuration belongs to another repository root.");
  }
  const result = await bindAgentOrganizationRuntime({ root, organizationId, teamId, config });
  io.stdout(
    parsed.values.json
      ? `${JSON.stringify(result, null, 2)}\n`
      : `Bound ${result.deployments.length} external agent deployment(s) to ${organizationId}/${teamId}.\n`,
  );
  return 0;
}
