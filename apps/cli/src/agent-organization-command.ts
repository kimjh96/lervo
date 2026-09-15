import { resolve } from "node:path";
import { parseArgs } from "node:util";

import { loadNodeRuntimeConfig } from "@lervo/node-runtime";

import {
  bindAgentOrganizationTeam,
  bindAgentOrganizationRuntime,
  inspectAgentOrganization,
  changeAgentOrganizationTeamKind,
} from "./agent-organization-runtime-binding.js";
import { runCeoEvaluationCommand } from "./ceo-command.js";
import { runOrganizationPortfolioCommand } from "./organization-portfolio-command.js";
import { runOrganizationExecutiveCommand } from "./organization-executive-command.js";
import type { CliIo } from "./types.js";

export const agentOrganizationUsage = [
  "  lervo organization inspect [--root <path>] [--json]",
  "  lervo organization bind-team --organization <id> --team <id> --kind <central|project> --write [--root <path>] [--json]",
  "  lervo organization set-team-kind --organization <id> --team <id> --kind <central|project> --write [--root <path>] [--json]",
  "  lervo organization bind-runtime --organization <id> --team <id> --config <node-config> --write [--root <path>] [--json]",
  "  lervo organization portfolio --organization <id> --team-root <path> [--team-root <path>...] [--json]",
  "  lervo organization ceo-evaluate --policy <file> --request <file> --report <file> [--json]",
  "  lervo organization executive-execute --organization <id> --team-root <path> [--team-root <path>...] --policy <file> --request <file> --effect <file> [--config <node-config>] --write [--root <path>] [--json]",
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
      kind: { type: "string" },
      config: { type: "string" },
      "team-root": { type: "string", multiple: true },
      policy: { type: "string" },
      request: { type: "string" },
      report: { type: "string" },
      effect: { type: "string" },
    },
  });
  if (parsed.values.help) {
    io.stdout(`${agentOrganizationUsage}\n`);
    return 0;
  }
  if (parsed.positionals.length !== 1) throw new Error("The organization action is invalid.");
  const action = parsed.positionals[0];
  if (action === "executive-execute") {
    if (
      !parsed.values.write ||
      parsed.values.policy === undefined ||
      parsed.values.request === undefined ||
      parsed.values.effect === undefined
    ) {
      throw new Error(
        "Organization executive execution requires policy, request, effect, team roots, and --write.",
      );
    }
    return runOrganizationExecutiveCommand({
      io,
      root: resolve(io.cwd, parsed.values.root ?? "."),
      organizationId: identifier(parsed.values.organization, "organization"),
      teamRoots: parsed.values["team-root"] ?? [],
      policyPath: parsed.values.policy,
      requestPath: parsed.values.request,
      effectPath: parsed.values.effect,
      configPath: parsed.values.config,
      json: parsed.values.json,
    });
  }
  if (action === "portfolio") {
    if (parsed.values.write) throw new Error("Organization portfolio inspection is read-only.");
    return runOrganizationPortfolioCommand({
      io,
      organizationId: identifier(parsed.values.organization, "organization"),
      teamRoots: parsed.values["team-root"] ?? [],
      json: parsed.values.json,
    });
  }
  if (action === "ceo-evaluate") {
    if (
      parsed.values.write ||
      parsed.values.policy === undefined ||
      parsed.values.request === undefined ||
      parsed.values.report === undefined
    ) {
      throw new Error(
        "CEO evaluation is read-only and requires policy, request, and report files.",
      );
    }
    return runCeoEvaluationCommand({
      io,
      policyPath: parsed.values.policy,
      requestPath: parsed.values.request,
      reportPath: parsed.values.report,
      json: parsed.values.json,
    });
  }
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
  if (action === "bind-team") {
    if (!parsed.values.write || !["central", "project"].includes(parsed.values.kind ?? "")) {
      throw new Error("Organization team binding requires exact IDs, kind, and --write.");
    }
    const result = await bindAgentOrganizationTeam({
      root,
      organizationId: identifier(parsed.values.organization, "organization"),
      teamId: identifier(parsed.values.team, "team"),
      teamKind: parsed.values.kind as "central" | "project",
    });
    io.stdout(
      parsed.values.json
        ? `${JSON.stringify(result, null, 2)}\n`
        : `Bound ${result.team!.organizationId}/${result.team!.teamId} as ${result.team!.teamKind}.\n`,
    );
    return 0;
  }
  if (action === "set-team-kind") {
    if (!parsed.values.write || !["central", "project"].includes(parsed.values.kind ?? "")) {
      throw new Error("Organization team reclassification requires exact IDs, kind, and --write.");
    }
    const result = await changeAgentOrganizationTeamKind({
      root,
      organizationId: identifier(parsed.values.organization, "organization"),
      teamId: identifier(parsed.values.team, "team"),
      teamKind: parsed.values.kind as "central" | "project",
    });
    io.stdout(
      parsed.values.json
        ? `${JSON.stringify(result, null, 2)}\n`
        : `Classified ${result.team!.organizationId}/${result.team!.teamId} as ${result.team!.teamKind}.\n`,
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
