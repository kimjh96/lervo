import { resolve } from "node:path";
import { parseArgs } from "node:util";

import { applyInitPlan, createInitPlan, type InitOperation, type InitPlan } from "@lervo/project";
import { listAgents, registerAgent, type WorkforceEvent } from "@lervo/agent-workforce";
import { openProjectStorage } from "@lervo/project-storage";
import { applyCapabilityMigration, createCapabilityMigrationPlan } from "@lervo/capabilities";

import type { CliIo } from "./types.js";
import { runKnowledgeMigration } from "./knowledge-command.js";
import { recordWorkforceEvent } from "./workforce-events.js";

export const initUsage =
  "  lervo init [--dry-run] [--minimal|--onboard] [--root <path>] [--name <name>] [--json]";

interface OnboardingResult {
  status: "pending_authority" | "provider_ready" | "blocked";
  initialAgentId: string;
  completedStages: string[];
  pendingStage: string | null;
  pendingPlan: Record<string, unknown> | null;
}

async function bootstrapOnboarding(root: string): Promise<OnboardingResult> {
  let agents = await listAgents(root);
  if (agents.length === 0) {
    const storage = await openProjectStorage(root);
    try {
      const agent = await registerAgent({
        repositoryRoot: root,
        roleId: "developer",
        provider: "any",
        responsibilityPaths: ["*"],
        recordEvent: (event: WorkforceEvent) => recordWorkforceEvent(storage, event),
      });
      agents = [agent];
    } finally {
      await storage.close();
    }
  }
  const initialAgent =
    agents.find((agent) => agent.status === "active" && agent.roleId === "developer") ??
    agents.find((agent) => agent.status === "active");
  if (initialAgent === undefined)
    throw new Error("Onboarding requires one active repository agent.");
  const completedStages = ["project_identity", "initial_agent"];
  const capabilityPlan = await createCapabilityMigrationPlan(root);
  if (capabilityPlan.status === "ready") await applyCapabilityMigration(capabilityPlan);
  completedStages.push("capability_repository_migration");
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const code = await runKnowledgeMigration({
      args: ["--root", root, "--json"],
      io: {
        cwd: root,
        stdout: (message) => stdout.push(message),
        stderr: (message) => stderr.push(message),
      },
      mode: "migrate",
    });
    let plan: Record<string, unknown>;
    try {
      plan = JSON.parse(stdout.join("")) as Record<string, unknown>;
    } catch {
      return {
        status: "blocked",
        initialAgentId: initialAgent.agentId,
        completedStages,
        pendingStage: "knowledge",
        pendingPlan: {
          failure: stderr.join("").trim() || "knowledge_plan_unavailable",
          exitCode: code,
        },
      };
    }
    if (plan.status === "ready" && typeof plan.planId === "string") {
      const applyOutput: string[] = [];
      const applyError: string[] = [];
      const applied = await runKnowledgeMigration({
        args: ["--root", root, "--apply", plan.planId, "--json"],
        io: {
          cwd: root,
          stdout: (message) => applyOutput.push(message),
          stderr: (message) => applyError.push(message),
        },
        mode: "migrate",
      });
      if (applied !== 0)
        return {
          status: "blocked",
          initialAgentId: initialAgent.agentId,
          completedStages,
          pendingStage: "knowledge",
          pendingPlan: { failure: applyError.join("").trim() || "safe_stage_apply_failed" },
        };
      completedStages.push(String(plan.planKind ?? "knowledge_materialization"));
      continue;
    }
    if (plan.status === "current") {
      completedStages.push(String(plan.planKind ?? "knowledge"));
      return {
        status: "provider_ready",
        initialAgentId: initialAgent.agentId,
        completedStages,
        pendingStage: null,
        pendingPlan: null,
      };
    }
    const pendingStage = String(
      plan.planKind ??
        (plan.status === "provider_required" ? "document_normalization" : "provider_integration"),
    );
    return {
      status: plan.status === "blocked" ? "blocked" : "pending_authority",
      initialAgentId: initialAgent.agentId,
      completedStages,
      pendingStage,
      pendingPlan: plan,
    };
  }
  return {
    status: "blocked",
    initialAgentId: initialAgent.agentId,
    completedStages,
    pendingStage: "onboarding_iteration_limit",
    pendingPlan: null,
  };
}

function operationLabel(operation: InitOperation): string {
  switch (operation.action) {
    case "create":
      return "create";
    case "unchanged":
      return "unchanged";
    case "conflict":
      return "conflict";
  }
}

export function formatInitPlan(plan: InitPlan): string {
  const lines = [
    `Initialization target: ${plan.root}`,
    `Plan status: ${plan.status === "ready" ? "ready to apply" : "blocked"}`,
  ];
  for (const operation of plan.operations) {
    lines.push(`  ${operationLabel(operation)}  ${operation.path}`);
    if (operation.action === "conflict") lines.push(`         ${operation.reason}`);
    if (operation.kind === "file" && operation.action === "create") {
      lines.push(
        "",
        ...operation.content
          .trimEnd()
          .split("\n")
          .map((line) => `    + ${line}`),
        "",
      );
    }
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

export async function runInitCommand(args: string[], io: CliIo): Promise<number> {
  let values: {
    dryRun: boolean | undefined;
    minimal: boolean | undefined;
    onboard: boolean | undefined;
    root: string | undefined;
    name: string | undefined;
    json: boolean | undefined;
    help: boolean | undefined;
  };
  try {
    const parsed = parseArgs({
      args,
      strict: true,
      allowPositionals: false,
      options: {
        "dry-run": { type: "boolean" },
        minimal: { type: "boolean" },
        onboard: { type: "boolean" },
        root: { type: "string" },
        name: { type: "string" },
        json: { type: "boolean" },
        help: { type: "boolean", short: "h" },
      },
    });
    values = {
      dryRun: parsed.values["dry-run"],
      minimal: parsed.values.minimal,
      onboard: parsed.values.onboard,
      root: parsed.values.root,
      name: parsed.values.name,
      json: parsed.values.json,
      help: parsed.values.help,
    };
  } catch (error) {
    io.stderr(`${error instanceof Error ? error.message : String(error)}\n${initUsage}\n`);
    return 1;
  }

  if (values.help) {
    io.stdout(`${initUsage}\n`);
    return 0;
  }
  if (values.minimal && values.onboard) {
    io.stderr(`Choose either --minimal or --onboard.\n${initUsage}\n`);
    return 1;
  }

  const root = resolve(io.cwd, values.root ?? ".");
  try {
    const plan = await createInitPlan({
      root,
      ...(values.name === undefined ? {} : { name: values.name }),
    });
    if (values.dryRun || !values.json)
      io.stdout(values.json ? `${JSON.stringify(plan, null, 2)}\n` : formatInitPlan(plan));
    if (plan.status === "blocked") return 1;
    if (values.dryRun) return 0;

    const result = await applyInitPlan(plan);
    const onboarding =
      values.minimal || (process.env.NODE_ENV === "test" && !values.onboard)
        ? null
        : await bootstrapOnboarding(root);
    if (values.json) {
      io.stdout(
        `${JSON.stringify({ schemaVersion: 1, initialization: plan, result, onboarding }, null, 2)}\n`,
      );
    }
    if (!values.json) {
      io.stdout(
        result.created.length > 0
          ? `Initialized the Lervo project. projectId: ${result.projectManifest.projectId}\n`
          : `The project is already initialized. projectId: ${result.projectManifest.projectId}\n`,
      );
      if (onboarding !== null) {
        io.stdout(
          `Onboarding: ${onboarding.status}\ninitial agent: ${onboarding.initialAgentId}\ncompleted: ${onboarding.completedStages.join(", ")}\n${onboarding.pendingStage === null ? "" : `pending: ${onboarding.pendingStage}\nRespond in natural language to the shown authority decision; the agent must perform the Lervo bookkeeping.\n`}`,
        );
      }
    }
    return 0;
  } catch (error) {
    io.stderr(`${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}
