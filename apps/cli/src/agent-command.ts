import { resolve } from "node:path";
import { parseArgs } from "node:util";

import {
  changeAgentDisplayName,
  changeAgentRole,
  changeAgentStatus,
  listAgents,
  registerAgent,
  type AgentStatus,
  type WorkforceProvider,
} from "@lervo/agent-workforce";
import { ensureTemplateRole, resolveRoleContract } from "@lervo/roles";

import { agentContextUsage, runAgentContextCommand } from "./agent-context-command.js";
import { agentMandateUsage, runAgentMandateCommand } from "./agent-mandate-command.js";
import { agentLivenessUsage, runAgentLivenessCommand } from "./agent-liveness-command.js";
import { noticeEffect } from "./effect-notice.js";
import type { CliIo } from "./types.js";
import { mutateWorkforceState } from "./workforce-mutation.js";

export const agentUsage = [
  "  lervo agent list [--root <path>] [--json]",
  "  lervo agent hire --role <role> [--name <display-name>] [--provider <codex|claude|any>] [--scope <path>] [--capability <package-id>] [--parent <agent-id>] --write [--root <path>] [--json]",
  "  lervo agent status --agent <agent-id> --status <active|suspended|retired> --revision <n> --write [--root <path>] [--json]",
  "  lervo agent rename --agent <agent-id> --name <display-name> --revision <n> --write [--root <path>] [--json]",
  "  lervo agent role --agent <agent-id> --role <role-id> --revision <n> --write [--root <path>] [--json]",
  agentLivenessUsage,
  agentContextUsage,
  agentMandateUsage,
].join("\n");

function role(value: string | undefined): string {
  if (
    value === undefined ||
    !/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/u.test(value) ||
    value.length > 100
  )
    throw new Error("The workforce role is invalid.");
  return value;
}

function revision(value: string | undefined): number {
  if (value === undefined || !/^\d+$/u.test(value))
    throw new Error("The agent revision is invalid.");
  return Number(value);
}

function output(io: CliIo, value: unknown, json: boolean | undefined, message: string): void {
  io.stdout(json ? `${JSON.stringify(value, null, 2)}\n` : `${message}\n`);
}

export async function runAgentCommand(args: string[], io: CliIo): Promise<number> {
  if (args[0] === "mandate") return runAgentMandateCommand(args.slice(1), io);
  if (args[0] === "context") return runAgentContextCommand(args.slice(1), io);
  if (["heartbeat", "inspect"].includes(args[0] ?? ""))
    return await runAgentLivenessCommand(args, io);
  const parsed = parseArgs({
    args,
    strict: true,
    allowPositionals: true,
    options: {
      root: { type: "string" },
      json: { type: "boolean" },
      write: { type: "boolean" },
      help: { type: "boolean", short: "h" },
      role: { type: "string" },
      name: { type: "string" },
      provider: { type: "string" },
      scope: { type: "string", multiple: true },
      parent: { type: "string" },
      capability: { type: "string", multiple: true },
      agent: { type: "string" },
      status: { type: "string" },
      revision: { type: "string" },
    },
  });
  if (parsed.values.help) {
    io.stdout(`${agentUsage}\n`);
    return 0;
  }
  if (parsed.positionals.length !== 1) throw new Error("The agent action is invalid.");
  const action = parsed.positionals[0];
  const root = resolve(io.cwd, parsed.values.root ?? ".");
  if (action === "list") {
    if (parsed.values.write) throw new Error("Agent list is read-only.");
    const agents = await listAgents(root);
    output(
      io,
      { schemaVersion: 1, agents },
      parsed.values.json,
      agents.length === 0
        ? "No repository agents."
        : agents
            .map(
              (agent) =>
                `${agent.displayName} · ${agent.agentId} · ${agent.roleId} · ${agent.status}${agent.parentAgentId === null ? "" : ` · parent ${agent.parentAgentId}`}`,
            )
            .join("\n"),
    );
    return 0;
  }
  if (action === "hire") {
    if (!parsed.values.write) throw new Error("Agent hiring requires --write.");
    const provider = parsed.values.provider ?? "any";
    if (!["codex", "claude", "any"].includes(provider))
      throw new Error("The agent provider is invalid.");
    // A project without a template role, such as `product-owner`, gets it on its first hire.
    const template = await ensureTemplateRole(root, role(parsed.values.role));
    await resolveRoleContract(root, role(parsed.values.role));
    const agent = await mutateWorkforceState(root, (recordEvent) =>
      registerAgent({
        repositoryRoot: root,
        roleId: role(parsed.values.role),
        provider: provider as WorkforceProvider,
        ...(parsed.values.name === undefined ? {} : { displayName: parsed.values.name }),
        responsibilityPaths: parsed.values.scope ?? ["*"],
        ...(parsed.values.capability === undefined
          ? {}
          : { capabilityPackageIds: parsed.values.capability }),
        ...(parsed.values.parent === undefined ? {} : { parentAgentId: parsed.values.parent }),
        recordEvent,
      }),
    );
    if (template === "written")
      await noticeEffect({
        repositoryRoot: root,
        effect: "role_template_written",
        subject: `${agent.roleId}:${agent.agentId}`,
        targets: [`.lervo/roles/${agent.roleId}.json`],
        reason: "first_hire_of_template_role",
        reviewers: ["role_contract_resolved"],
        verdict: "verified",
        undo: `lervo agent status --agent ${agent.agentId} --status retired --revision ${agent.revision} --write`,
      });
    output(
      io,
      agent,
      parsed.values.json,
      `${agent.displayName} (${agent.agentId}) hired as ${agent.roleId}${agent.parentAgentId === null ? "" : ` under ${agent.parentAgentId}`}.`,
    );
    return 0;
  }
  if (action === "status") {
    if (
      !parsed.values.write ||
      parsed.values.agent === undefined ||
      !["active", "suspended", "retired"].includes(parsed.values.status ?? "")
    )
      throw new Error("Agent status requires exact transition coordinates and --write.");
    const agent = await mutateWorkforceState(root, (recordEvent) =>
      changeAgentStatus({
        repositoryRoot: root,
        agentId: parsed.values.agent!,
        expectedRevision: revision(parsed.values.revision),
        status: parsed.values.status as AgentStatus,
        recordEvent,
      }),
    );
    output(
      io,
      agent,
      parsed.values.json,
      `Agent ${agent.agentId} is ${agent.status} at revision ${agent.revision}.`,
    );
    return 0;
  }
  if (action === "rename") {
    if (
      !parsed.values.write ||
      parsed.values.agent === undefined ||
      parsed.values.name === undefined
    ) {
      throw new Error("Agent rename requires exact identity, name, revision, and --write.");
    }
    const agent = await mutateWorkforceState(root, (recordEvent) =>
      changeAgentDisplayName({
        repositoryRoot: root,
        agentId: parsed.values.agent!,
        displayName: parsed.values.name!,
        expectedRevision: revision(parsed.values.revision),
        recordEvent,
      }),
    );
    output(io, agent, parsed.values.json, `${agent.agentId} is now named ${agent.displayName}.`);
    return 0;
  }
  if (action === "role") {
    if (!parsed.values.write || parsed.values.agent === undefined) {
      throw new Error(
        "Agent role transition requires exact identity, role, revision, and --write.",
      );
    }
    const agent = await mutateWorkforceState(root, (recordEvent) =>
      changeAgentRole({
        repositoryRoot: root,
        agentId: parsed.values.agent!,
        roleId: role(parsed.values.role),
        expectedRevision: revision(parsed.values.revision),
        recordEvent,
      }),
    );
    output(
      io,
      agent,
      parsed.values.json,
      `Agent ${agent.displayName} (${agent.agentId}) now holds role ${agent.roleId} at revision ${agent.revision}.`,
    );
    return 0;
  }
  throw new Error("The agent action is invalid.");
}
