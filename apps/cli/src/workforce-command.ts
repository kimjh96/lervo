import { resolve } from "node:path";
import { parseArgs } from "node:util";

import {
  changeAgentStatus,
  claimAssignment,
  completeAssignment,
  createAssignment,
  listAgents,
  listAssignments,
  planGroundedWorkforceRequest,
  recordAssignmentHandoff,
  renewAssignmentLease,
  registerAgent,
  type WorkforceArtifactReference,
  type WorkforceEvent,
} from "@lervo/agent-workforce";
import { openProjectStorage } from "@lervo/project-storage";
import { listRoleContracts, resolveRoleContract } from "@lervo/roles";

import type { CliIo, CliServices } from "./types.js";
import {
  assignmentCancellationUsage,
  runAssignmentCancellationCommand,
} from "./assignment-cancellation-command.js";
import { recordWorkforceEvent } from "./workforce-events.js";

export const workforceUsage = [
  "  lervo workforce plan --request <natural-language-request> --provider <codex|claude> [--root <path>] [--json]",
  "  lervo agent list [--root <path>] [--json]",
  "  lervo agent hire --role <role> [--provider <codex|claude|any>] [--scope <path>] [--capability <package-id>] [--parent <agent-id>] --write [--root <path>] [--json]",
  "  lervo agent status --agent <agent-id> --status <active|suspended|retired> --revision <n> --write [--root <path>] [--json]",
  "  lervo assignment list [--root <path>] [--json]",
  "  lervo assignment create --type <type> --role <role> --criteria <text> --suite <id> --path <path> [--dependency <id>] [--approval <requirement>] [--workstream <id>] [--priority <0-100>] --write [--root <path>] [--json]",
  "  lervo assignment claim --assignment <id> --agent <id> --session <id> [--lease-ms <ms>] --write [--root <path>] [--json]",
  "  lervo assignment renew --assignment <id> --agent <id> --lease <id> [--lease-ms <ms>] --write [--root <path>] [--json]",
  "  lervo assignment handoff --assignment <id> --from-agent <id> --to-agent <id> --lease <id> --request-digest <sha256> --artifact <id>=<sha256> --evidence-event <id> --write [--root <path>] [--json]",
  assignmentCancellationUsage,
  "  lervo assignment complete --assignment <id> --agent <id> --lease <id> --verification <passed|failed> [--artifact <id>=<sha256>] [--failure-code <code>] --write [--root <path>] [--json]",
].join("\n");

function parse(args: string[]) {
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
      provider: { type: "string" },
      scope: { type: "string", multiple: true },
      parent: { type: "string" },
      capability: { type: "string", multiple: true },
      agent: { type: "string" },
      status: { type: "string" },
      revision: { type: "string" },
      type: { type: "string" },
      criteria: { type: "string", multiple: true },
      suite: { type: "string", multiple: true },
      path: { type: "string", multiple: true },
      dependency: { type: "string", multiple: true },
      approval: { type: "string", multiple: true },
      workstream: { type: "string" },
      priority: { type: "string" },
      assignment: { type: "string" },
      session: { type: "string" },
      "lease-ms": { type: "string" },
      lease: { type: "string" },
      "from-agent": { type: "string" },
      "to-agent": { type: "string" },
      "request-digest": { type: "string" },
      artifact: { type: "string", multiple: true },
      "evidence-event": { type: "string", multiple: true },
      verification: { type: "string" },
      "failure-code": { type: "string" },
      request: { type: "string" },
    },
  });
}

function integer(value: string | undefined, fallback?: number): number {
  if (value === undefined && fallback !== undefined) return fallback;
  if (value === undefined || !/^\d+$/u.test(value))
    throw new Error("An integer workforce coordinate is invalid.");
  return Number(value);
}

function role(value: string | undefined): string {
  if (
    value === undefined ||
    !/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/u.test(value) ||
    value.length > 100
  )
    throw new Error("The workforce role is invalid.");
  return value;
}

function artifacts(values: string[] | undefined): WorkforceArtifactReference[] {
  return (values ?? []).map((value) => {
    const match = /^(art_[A-Za-z0-9_-]{8,128})=(sha256:[a-f0-9]{64})$/u.exec(value);
    if (match === null) throw new Error("--artifact must use <artifact-id>=<sha256>.");
    return { artifactId: match[1]!, contentHash: match[2]! };
  });
}

async function mutate<T>(
  root: string,
  operation: (recordEvent: (event: WorkforceEvent) => void) => Promise<T>,
): Promise<T> {
  const storage = await openProjectStorage(root);
  try {
    return await operation((event) => recordWorkforceEvent(storage, event));
  } finally {
    await storage.close();
  }
}

function output(io: CliIo, value: unknown, json: boolean | undefined, message: string): void {
  io.stdout(json ? `${JSON.stringify(value, null, 2)}\n` : `${message}\n`);
}

export async function runWorkforceCommand(
  namespace: "workforce" | "agent" | "assignment",
  args: string[],
  io: CliIo,
  services: Pick<CliServices, "groundProductionRequest">,
): Promise<number> {
  if (namespace === "assignment" && args[0] === "cancel") {
    return runAssignmentCancellationCommand(args, io);
  }
  try {
    const parsed = parse(args);
    if (parsed.values.help) {
      io.stdout(`${workforceUsage}\n`);
      return 0;
    }
    const action = parsed.positionals[0];
    if (parsed.positionals.length !== 1) throw new Error("The workforce action is invalid.");
    const root = resolve(io.cwd, parsed.values.root ?? ".");
    if (namespace === "workforce" && action === "plan") {
      if (parsed.values.write || parsed.values.request === undefined)
        throw new Error("Natural-language workforce planning is read-only and requires --request.");
      if (parsed.values.provider !== "codex" && parsed.values.provider !== "claude")
        throw new Error("Natural-language workforce planning requires the current --provider.");
      const [agents, assignments, contracts] = await Promise.all([
        listAgents(root),
        listAssignments(root),
        listRoleContracts(root),
      ]);
      const roles = contracts.map((contract) => ({
        roleId: contract.roleId,
        name: contract.definition.profile.name,
        sourceKind: contract.sourceKind,
      }));
      const grounded = await services.groundProductionRequest({
        request: parsed.values.request,
        provider: parsed.values.provider,
        resolutionContext: {
          priorTurns: [],
          currentWorkstream: null,
          pendingAuthorityIds: [],
          repositoryCondition: "current",
        },
        grantedAuthorities: ["read", "repository_write", "user_approval"],
        semanticCatalog: {
          roleIds: roles.map((role) => role.roleId),
          agentIds: agents.map((agent) => agent.agentId),
          assignmentIds: assignments.map((assignment) => assignment.assignmentId),
        },
        workflows: [
          {
            workflowId: "workforce.inspect",
            supportedIntents: ["inspect"],
            supportedDispositions: ["answer"],
            effectIds: ["workforce.inspect"],
            requiredSourceClasses: ["repository_state"],
            authority: "read",
            allowedCapabilityIds: [],
            crossProviderAllowed: false,
          },
          ...["hire", "assign", "handoff", "retire"].map((kind) => ({
            workflowId: `workforce.${kind}`,
            supportedIntents: ["coordinate_agents" as const],
            supportedDispositions: ["execute" as const],
            effectIds: [`workforce.${kind}`],
            requiredSourceClasses: ["repository_state" as const],
            authority: "repository_write" as const,
            allowedCapabilityIds: [],
            crossProviderAllowed: false,
          })),
          {
            workflowId: "workforce.resolve",
            supportedIntents: ["resolve_approval"],
            supportedDispositions: ["execute"],
            effectIds: ["workforce.resolve"],
            requiredSourceClasses: ["current_workstream"],
            authority: "user_approval",
            allowedCapabilityIds: [],
            crossProviderAllowed: false,
          },
        ],
      });
      const plan = planGroundedWorkforceRequest({
        proposal: grounded.proposal,
        decision: grounded.decision,
        agents,
        assignments,
        roles,
      });
      output(
        io,
        plan,
        parsed.values.json,
        `Workforce request: ${plan.status}\nintent: ${plan.intent}\noperation: ${plan.operation === null ? "none" : `${plan.operation.namespace} ${plan.operation.action}`}\n${plan.pending.map((item) => `  pending ${item.field}: ${item.reason}`).join("\n")}`.trimEnd(),
      );
      return plan.status === "unrecognized" ? 1 : 0;
    }
    if (namespace === "agent" && action === "list") {
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
                  `${agent.agentId} · ${agent.roleId} · ${agent.status}${agent.parentAgentId === null ? "" : ` · parent ${agent.parentAgentId}`}`,
              )
              .join("\n"),
      );
      return 0;
    }
    if (namespace === "agent" && action === "hire") {
      if (!parsed.values.write) throw new Error("Agent hiring requires --write.");
      const provider = parsed.values.provider ?? "any";
      if (!["codex", "claude", "any"].includes(provider))
        throw new Error("The agent provider is invalid.");
      await resolveRoleContract(root, role(parsed.values.role));
      const agent = await mutate(root, (recordEvent) =>
        registerAgent({
          repositoryRoot: root,
          roleId: role(parsed.values.role),
          provider: provider as "codex" | "claude" | "any",
          responsibilityPaths: parsed.values.scope ?? ["*"],
          ...(parsed.values.capability === undefined
            ? {}
            : { capabilityPackageIds: parsed.values.capability }),
          ...(parsed.values.parent === undefined ? {} : { parentAgentId: parsed.values.parent }),
          recordEvent,
        }),
      );
      output(
        io,
        agent,
        parsed.values.json,
        `Agent ${agent.agentId} hired as ${agent.roleId}${agent.parentAgentId === null ? "" : ` under ${agent.parentAgentId}`}.`,
      );
      return 0;
    }
    if (namespace === "agent" && action === "status") {
      if (
        !parsed.values.write ||
        parsed.values.agent === undefined ||
        !["active", "suspended", "retired"].includes(parsed.values.status ?? "")
      )
        throw new Error("Agent status requires exact transition coordinates and --write.");
      const agent = await mutate(root, (recordEvent) =>
        changeAgentStatus({
          repositoryRoot: root,
          agentId: parsed.values.agent!,
          expectedRevision: integer(parsed.values.revision),
          status: parsed.values.status as "active" | "suspended" | "retired",
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
    if (namespace === "assignment" && action === "list") {
      if (parsed.values.write) throw new Error("Assignment list is read-only.");
      const assignments = await listAssignments(root);
      output(
        io,
        { schemaVersion: 1, assignments },
        parsed.values.json,
        assignments.length === 0
          ? "No repository assignments."
          : assignments
              .map(
                (item) =>
                  `${item.assignmentId} · ${item.roleId} · ${item.status} · priority ${item.priority}`,
              )
              .join("\n"),
      );
      return 0;
    }
    if (namespace === "assignment" && action === "create") {
      if (
        !parsed.values.write ||
        parsed.values.type === undefined ||
        (parsed.values.criteria?.length ?? 0) === 0 ||
        (parsed.values.suite?.length ?? 0) === 0 ||
        (parsed.values.path?.length ?? 0) === 0
      )
        throw new Error(
          "Assignment creation requires type, role, criteria, suite, path, and --write.",
        );
      await resolveRoleContract(root, role(parsed.values.role));
      const assignment = await mutate(root, (recordEvent) =>
        createAssignment({
          repositoryRoot: root,
          taskType: parsed.values.type!,
          roleId: role(parsed.values.role),
          priority: integer(parsed.values.priority, 50),
          dependencyIds: parsed.values.dependency ?? [],
          acceptanceCriteria: parsed.values.criteria!,
          verificationSuiteIds: parsed.values.suite!,
          approvalRequirements: parsed.values.approval ?? [],
          expectedPaths: parsed.values.path!,
          ...(parsed.values.workstream === undefined
            ? {}
            : { workstreamId: parsed.values.workstream }),
          recordEvent,
        }),
      );
      output(
        io,
        assignment,
        parsed.values.json,
        `Assignment ${assignment.assignmentId} queued for ${assignment.roleId}.`,
      );
      return 0;
    }
    if (namespace === "assignment" && action === "claim") {
      if (
        !parsed.values.write ||
        parsed.values.assignment === undefined ||
        parsed.values.agent === undefined ||
        parsed.values.session === undefined
      )
        throw new Error("Assignment claim requires assignment, agent, session, and --write.");
      const assignment = await mutate(root, (recordEvent) =>
        claimAssignment({
          repositoryRoot: root,
          assignmentId: parsed.values.assignment!,
          agentId: parsed.values.agent!,
          sessionId: parsed.values.session!,
          ...(parsed.values["lease-ms"] === undefined
            ? {}
            : { leaseDurationMs: integer(parsed.values["lease-ms"]) }),
          recordEvent,
        }),
      );
      output(
        io,
        assignment,
        parsed.values.json,
        `Assignment ${assignment.assignmentId} leased to ${assignment.assigneeAgentId}.`,
      );
      return 0;
    }
    if (namespace === "assignment" && action === "renew") {
      if (
        !parsed.values.write ||
        parsed.values.assignment === undefined ||
        parsed.values.agent === undefined ||
        parsed.values.lease === undefined
      )
        throw new Error("Assignment renewal requires assignment, agent, lease, and --write.");
      const assignment = await mutate(root, (recordEvent) =>
        renewAssignmentLease({
          repositoryRoot: root,
          assignmentId: parsed.values.assignment!,
          agentId: parsed.values.agent!,
          leaseId: parsed.values.lease!,
          ...(parsed.values["lease-ms"] === undefined
            ? {}
            : { leaseDurationMs: integer(parsed.values["lease-ms"]) }),
          recordEvent,
        }),
      );
      output(
        io,
        assignment,
        parsed.values.json,
        `Assignment ${assignment.assignmentId} lease renewed until ${assignment.lease!.expiresAt}.`,
      );
      return 0;
    }
    if (namespace === "assignment" && action === "handoff") {
      if (
        !parsed.values.write ||
        parsed.values.assignment === undefined ||
        parsed.values["from-agent"] === undefined ||
        parsed.values["to-agent"] === undefined ||
        parsed.values.lease === undefined ||
        parsed.values["request-digest"] === undefined
      )
        throw new Error(
          "Assignment handoff requires exact source, recipient, lease, and request coordinates.",
        );
      const assignment = await mutate(root, (recordEvent) =>
        recordAssignmentHandoff({
          repositoryRoot: root,
          assignmentId: parsed.values.assignment!,
          fromAgentId: parsed.values["from-agent"]!,
          toAgentId: parsed.values["to-agent"]!,
          leaseId: parsed.values.lease!,
          requestDigest: parsed.values["request-digest"]!,
          artifactReferences: artifacts(parsed.values.artifact),
          contextEvidenceEventIds: parsed.values["evidence-event"] ?? [],
          recordEvent,
        }),
      );
      output(
        io,
        assignment,
        parsed.values.json,
        `Assignment ${assignment.assignmentId} recorded handoff ${assignment.handoffs.at(-1)!.handoffId}.`,
      );
      return 0;
    }
    if (namespace === "assignment" && action === "complete") {
      if (
        !parsed.values.write ||
        parsed.values.assignment === undefined ||
        parsed.values.agent === undefined ||
        parsed.values.lease === undefined ||
        !["passed", "failed"].includes(parsed.values.verification ?? "")
      )
        throw new Error("Assignment completion requires exact lease and verification coordinates.");
      const assignment = await mutate(root, (recordEvent) =>
        completeAssignment({
          repositoryRoot: root,
          assignmentId: parsed.values.assignment!,
          agentId: parsed.values.agent!,
          leaseId: parsed.values.lease!,
          resultArtifacts: artifacts(parsed.values.artifact),
          verificationStatus: parsed.values.verification as "passed" | "failed",
          ...(parsed.values["failure-code"] === undefined
            ? {}
            : { failureCode: parsed.values["failure-code"] }),
          recordEvent,
        }),
      );
      output(
        io,
        assignment,
        parsed.values.json,
        `Assignment ${assignment.assignmentId} ${assignment.status}.`,
      );
      return 0;
    }
    throw new Error("The workforce action is invalid.");
  } catch (error) {
    const code =
      typeof error === "object" && error !== null && "code" in error
        ? String(error.code)
        : "workforce_command_failed";
    io.stderr(
      `Workforce command failed (${code}): ${error instanceof Error ? error.message : String(error)}\n${workforceUsage}\n`,
    );
    return 1;
  }
}
