import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs } from "node:util";

import {
  changeAgentModel,
  modelEfforts,
  modelTiers,
  type ModelEffort,
  type ModelTier,
  changeAgentDisplayName,
  changeAgentStatus,
  listAgents,
  type AgentStatus,
  type WorkforceProvider,
} from "@lervo/agent-workforce";

import { agentContextUsage, runAgentContextCommand } from "./agent-context-command.js";
import { agentMandateUsage, runAgentMandateCommand } from "./agent-mandate-command.js";
import { agentLivenessUsage, runAgentLivenessCommand } from "./agent-liveness-command.js";
import { hireAgent } from "./agent-hire.js";
import { moveAgentToRole } from "./agent-role-move.js";
import { commandActor } from "./organization-authority.js";
import { clearAgentMark, setAgentMark } from "./core-link-agent-marks.js";
import type { CliIo } from "./types.js";
import { mutateWorkforceState } from "./workforce-mutation.js";

export const agentUsage = [
  "  lervo agent list [--root <path>] [--json]",
  "  lervo agent hire --role <role> [--name <display-name>] [--provider <codex|claude|any>] [--scope <path>] [--capability <package-id>] [--parent <agent-id>] --write [--root <path>] [--json]",
  "  lervo agent status --agent <agent-id> --status <active|suspended|retired> --revision <n> --write [--root <path>] [--json]",
  "  lervo agent rename --agent <agent-id> --name <display-name> --revision <n> --write [--root <path>] [--json]",
  "  lervo agent role --agent <agent-id> --role <role-id> --revision <n> --write [--root <path>] [--json]",
  "  lervo agent model --agent <agent-id> --tier <frontier|strong|balanced|fast> --effort <low|medium|high|xhigh|max> --revision <n> --write [--root <path>] [--json]",
  "  lervo agent mark --agent <agent-id> (--image <file> | --clear) --revision <n> --write [--root <path>] [--json]",
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

/** The agent command's flags, as `parseArgs` reads them. */
function parseAgentArguments(args: string[]) {
  return parseArgs({
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
      tier: { type: "string" },
      effort: { type: "string" },
      provider: { type: "string" },
      scope: { type: "string", multiple: true },
      parent: { type: "string" },
      capability: { type: "string", multiple: true },
      agent: { type: "string" },
      status: { type: "string" },
      revision: { type: "string" },
      image: { type: "string" },
      clear: { type: "boolean" },
    },
  });
}

type AgentValues = ReturnType<typeof parseAgentArguments>["values"];

/** One `lervo agent` action: what it does with the flags, in the repository at `root`. */
type AgentAction = (values: AgentValues, root: string, io: CliIo) => Promise<void>;

/** Lists the repository's agents. */
async function listAction(values: AgentValues, root: string, io: CliIo): Promise<void> {
  if (values.write) throw new Error("Agent list is read-only.");
  const agents = await listAgents(root);
  output(
    io,
    { schemaVersion: 1, agents },
    values.json,
    agents.length === 0
      ? "No repository agents."
      : agents
          .map(
            (agent) =>
              `${agent.displayName} · ${agent.agentId} · ${agent.roleId} · ${agent.status}${agent.parentAgentId === null ? "" : ` · parent ${agent.parentAgentId}`}`,
          )
          .join("\n"),
  );
}

/** Hires an agent for a role. */
async function hireAction(values: AgentValues, root: string, io: CliIo): Promise<void> {
  if (!values.write) throw new Error("Agent hiring requires --write.");
  const provider = values.provider ?? "any";
  if (!["codex", "claude", "any"].includes(provider))
    throw new Error("The agent provider is invalid.");
  const agent = await hireAgent(root, {
    roleId: role(values.role),
    provider: provider as WorkforceProvider,
    ...(values.name === undefined ? {} : { displayName: values.name }),
    responsibilityPaths: values.scope ?? ["*"],
    ...(values.capability === undefined ? {} : { capabilityPackageIds: values.capability }),
    ...(values.parent === undefined ? {} : { parentAgentId: values.parent }),
    ...withActor(),
  });
  output(
    io,
    agent,
    values.json,
    `${agent.displayName} (${agent.agentId}) hired as ${agent.roleId}${agent.parentAgentId === null ? "" : ` under ${agent.parentAgentId}`}.`,
  );
}

/** Pauses, resumes, or retires an agent. */
async function statusAction(values: AgentValues, root: string, io: CliIo): Promise<void> {
  if (
    !values.write ||
    values.agent === undefined ||
    !["active", "suspended", "retired"].includes(values.status ?? "")
  )
    throw new Error("Agent status requires exact transition coordinates and --write.");
  const agent = await mutateWorkforceState(root, (recordEvent) =>
    changeAgentStatus({
      repositoryRoot: root,
      agentId: values.agent!,
      expectedRevision: revision(values.revision),
      status: values.status as AgentStatus,
      recordEvent,
    }),
  );
  output(
    io,
    agent,
    values.json,
    `Agent ${agent.agentId} is ${agent.status} at revision ${agent.revision}.`,
  );
}

/** Renames an agent. */
async function renameAction(values: AgentValues, root: string, io: CliIo): Promise<void> {
  if (!values.write || values.agent === undefined || values.name === undefined) {
    throw new Error("Agent rename requires exact identity, name, revision, and --write.");
  }
  const agent = await mutateWorkforceState(root, (recordEvent) =>
    changeAgentDisplayName({
      repositoryRoot: root,
      agentId: values.agent!,
      displayName: values.name!,
      expectedRevision: revision(values.revision),
      recordEvent,
    }),
  );
  output(io, agent, values.json, `${agent.agentId} is now named ${agent.displayName}.`);
}

/** Sets the model and effort an agent's sessions run with. */
async function modelAction(values: AgentValues, root: string, io: CliIo): Promise<void> {
  const tier = values.tier as ModelTier | undefined;
  const effort = values.effort as ModelEffort | undefined;
  if (
    !values.write ||
    values.agent === undefined ||
    tier === undefined ||
    !modelTiers.includes(tier) ||
    effort === undefined ||
    !modelEfforts.includes(effort)
  )
    throw new Error("Agent model requires exact identity, tier, effort, revision, and --write.");
  const agent = await mutateWorkforceState(root, (recordEvent) =>
    changeAgentModel({
      repositoryRoot: root,
      agentId: values.agent!,
      tier,
      effort,
      expectedRevision: revision(values.revision),
      recordEvent,
    }),
  );
  output(
    io,
    agent,
    values.json,
    `${agent.displayName} now runs on the ${tier} model at ${effort} effort.`,
  );
}

/** Sets or clears an agent's image. */
async function markAction(values: AgentValues, root: string, io: CliIo): Promise<void> {
  const image = values.image;
  if (
    !values.write ||
    values.agent === undefined ||
    (image === undefined) === (values.clear !== true)
  )
    throw new Error(
      "Agent mark requires exact identity, either --image or --clear, revision, and --write.",
    );
  const expectedRevision = revision(values.revision);
  const agent =
    image === undefined
      ? await clearAgentMark(root, values.agent, expectedRevision)
      : await setAgentMark(
          root,
          values.agent,
          expectedRevision,
          (await readFile(resolve(io.cwd, image))).toString("base64"),
        );
  output(
    io,
    agent,
    values.json,
    image === undefined
      ? `${agent.displayName} shows its first letter again.`
      : `${agent.displayName} now shows the chosen image.`,
  );
}

/** Moves an agent to another role, pausing it for the move when it is working (ADR-0662). */
async function roleAction(values: AgentValues, root: string, io: CliIo): Promise<void> {
  if (!values.write || values.agent === undefined) {
    throw new Error("Agent role transition requires exact identity, role, revision, and --write.");
  }
  const agent = await moveAgentToRole(
    root,
    {
      agentId: values.agent,
      roleId: role(values.role),
      expectedRevision: revision(values.revision),
    },
    commandActor(),
  );
  output(
    io,
    agent,
    values.json,
    `Agent ${agent.displayName} (${agent.agentId}) now holds role ${agent.roleId} at revision ${agent.revision}.`,
  );
}

/** The hired agent this command runs for, when an agent's own session runs it. */
function withActor(): { actorAgentId?: string } {
  const actorAgentId = commandActor();
  return actorAgentId === undefined ? {} : { actorAgentId };
}

/** Each `lervo agent` action that changes or reads the workforce, by name. */
const agentActions: Readonly<Record<string, AgentAction>> = {
  list: listAction,
  hire: hireAction,
  status: statusAction,
  rename: renameAction,
  model: modelAction,
  mark: markAction,
  role: roleAction,
};

export async function runAgentCommand(args: string[], io: CliIo): Promise<number> {
  if (args[0] === "mandate") return runAgentMandateCommand(args.slice(1), io);
  if (args[0] === "context") return runAgentContextCommand(args.slice(1), io);
  if (["heartbeat", "inspect"].includes(args[0] ?? ""))
    return await runAgentLivenessCommand(args, io);
  const parsed = parseAgentArguments(args);
  if (parsed.values.help) {
    io.stdout(`${agentUsage}\n`);
    return 0;
  }
  const action = parsed.positionals.length === 1 ? parsed.positionals[0]! : "";
  if (!Object.hasOwn(agentActions, action)) throw new Error("The agent action is invalid.");
  await agentActions[action]!(parsed.values, resolve(io.cwd, parsed.values.root ?? "."), io);
  return 0;
}
