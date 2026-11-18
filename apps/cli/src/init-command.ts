import { resolve } from "node:path";
import { parseArgs } from "node:util";

import { applyInitPlan, createInitPlan, type InitOperation, type InitPlan } from "@lervo/project";

import type { CliIo } from "./types.js";
import { bootstrapOnboarding } from "./init-onboarding.js";
import { onboardKnowledgeContinuity } from "./knowledge-continuity-onboarding.js";

export const initUsage =
  "  lervo init [--dry-run] [--minimal|--onboard] [--root <path>] [--name <name>] [--json]";

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
    // ADR-0469 default onboarding: on a host with a continuity policy, join the host registry and
    // derive owner-host configuration and delegation now; otherwise nothing changes.
    const knowledgeContinuity =
      onboarding === null || onboarding.status === "blocked"
        ? null
        : await onboardKnowledgeContinuity({ repositoryRoot: root, register: true });
    if (values.json) {
      io.stdout(
        `${JSON.stringify(
          { schemaVersion: 1, initialization: plan, result, onboarding, knowledgeContinuity },
          null,
          2,
        )}\n`,
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
          `Onboarding: ${onboarding.status}\ninitial agent: ${onboarding.initialAgentId}\ncompleted: ${onboarding.completedStages.join(", ")}\n${onboarding.pendingStage === null ? "" : `pending: ${onboarding.pendingStage}${onboarding.debtReason === undefined ? "" : ` (Lervo debt: ${onboarding.debtReason}; lervo upgrade --apply retries it, no owner action)`}\n`}`,
        );
        if (knowledgeContinuity !== null)
          io.stdout(
            `knowledge continuity: delegation ${knowledgeContinuity.delegation} · owner-host ${knowledgeContinuity.ownerHost}\n`,
          );
      }
    }
    return 0;
  } catch (error) {
    io.stderr(`${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}
