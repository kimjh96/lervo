import { resolve } from "node:path";
import { parseArgs } from "node:util";

import {
  applyInitPlan,
  createInitPlan,
  type InitOperation,
  type InitPlan,
} from "@lervo/project";

import type { CliIo } from "./types.js";

export const initUsage = "  lervo init [--dry-run] [--root <path>] [--name <name>] [--json]";

function operationLabel(operation: InitOperation): string {
  switch (operation.action) {
    case "create":
      return "생성";
    case "unchanged":
      return "유지";
    case "conflict":
      return "충돌";
  }
}

export function formatInitPlan(plan: InitPlan): string {
  const lines = [
    `초기화 대상: ${plan.root}`,
    `계획 상태: ${plan.status === "ready" ? "적용 가능" : "적용 불가"}`,
  ];
  for (const operation of plan.operations) {
    lines.push(`  ${operationLabel(operation)}  ${operation.path}`);
    if (operation.action === "conflict") lines.push(`         ${operation.reason}`);
    if (operation.kind === "file" && operation.action === "create") {
      lines.push("", ...operation.content.trimEnd().split("\n").map((line) => `    + ${line}`), "");
    }
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

export async function runInitCommand(args: string[], io: CliIo): Promise<number> {
  let values: {
    dryRun: boolean | undefined;
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
        root: { type: "string" },
        name: { type: "string" },
        json: { type: "boolean" },
        help: { type: "boolean", short: "h" },
      },
    });
    values = {
      dryRun: parsed.values["dry-run"],
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

  const root = resolve(io.cwd, values.root ?? ".");
  try {
    const plan = await createInitPlan({
      root,
      ...(values.name === undefined ? {} : { name: values.name }),
    });
    io.stdout(values.json ? `${JSON.stringify(plan, null, 2)}\n` : formatInitPlan(plan));
    if (plan.status === "blocked") return 1;
    if (values.dryRun) return 0;

    const result = await applyInitPlan(plan);
    if (!values.json) {
      io.stdout(
        result.created.length > 0
          ? `Lervo 프로젝트를 초기화했습니다. projectId: ${result.projectManifest.projectId}\n`
          : `이미 초기화된 프로젝트입니다. projectId: ${result.projectManifest.projectId}\n`,
      );
    }
    return 0;
  } catch (error) {
    io.stderr(`${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}
