import { resolve } from "node:path";
import { parseArgs } from "node:util";

import {
  createTerminalBudgetReport,
  createTerminalCoverageReport,
  type TerminalBudgetPolicy,
} from "@lervo/diagnostics";
import { openProjectStorage, type ProjectStorage } from "@lervo/project-storage";

import { formatTerminalBudgetReport } from "./terminal-budget-format.js";
import { terminalUsage } from "./terminal-command-usage.js";
import { resolveTerminalRepositoryRoot } from "./terminal-repository-root.js";
import type { CliIo } from "./types.js";

function boundedInteger(value: string | undefined, fallback: number, maximum: number): number {
  if (value === undefined) return fallback;
  if (!/^[1-9]\d*$/u.test(value)) throw new Error("A terminal budget integer is invalid.");
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed > maximum)
    throw new Error("A terminal budget integer exceeds its bound.");
  return parsed;
}

export async function runTerminalBudgetCommand(args: string[], io: CliIo): Promise<number> {
  let storage: ProjectStorage | undefined;
  try {
    const parsed = parseArgs({
      args,
      strict: true,
      allowPositionals: false,
      options: {
        root: { type: "string" },
        provider: { type: "string" },
        limit: { type: "string" },
        "minimum-samples": { type: "string" },
        "max-query-tokens": { type: "string" },
        unobserved: { type: "string" },
        exhausted: { type: "string" },
        json: { type: "boolean" },
      },
    });
    const provider = parsed.values.provider;
    if (provider !== undefined && provider !== "codex" && provider !== "claude")
      throw new Error("--provider must be codex or claude.");
    const unobservedAction = parsed.values.unobserved ?? "escalate";
    const exhaustedAction = parsed.values.exhausted ?? "block";
    if (
      (unobservedAction !== "block" && unobservedAction !== "escalate") ||
      (exhaustedAction !== "block" && exhaustedAction !== "escalate")
    )
      throw new Error("Terminal budget actions must be block or escalate.");
    const limit = boundedInteger(parsed.values.limit, 100, 100);
    const minimumSamples = boundedInteger(parsed.values["minimum-samples"], 30, 100);
    const maxQueryProjectionTokens =
      parsed.values["max-query-tokens"] === undefined
        ? null
        : boundedInteger(parsed.values["max-query-tokens"], 1, Number.MAX_SAFE_INTEGER);
    const root = await resolveTerminalRepositoryRoot(resolve(io.cwd, parsed.values.root ?? "."));
    storage = await openProjectStorage(root);
    const coverage = createTerminalCoverageReport({
      projectId: storage.manifest.projectId,
      events: storage.events,
      ...(provider === undefined ? {} : { provider }),
      limit,
    });
    const policy: Partial<TerminalBudgetPolicy> = {
      minimumSamples,
      maxQueryProjectionTokens,
      unobservedAction,
      exhaustedAction,
    };
    const report = createTerminalBudgetReport({ coverage, policy });
    io.stdout(
      parsed.values.json
        ? `${JSON.stringify(report, null, 2)}\n`
        : formatTerminalBudgetReport(report),
    );
    return report.disposition === "passed" ? 0 : 1;
  } catch (error) {
    io.stderr(`${error instanceof Error ? error.message : String(error)}\n${terminalUsage}\n`);
    return 1;
  } finally {
    await storage?.close();
  }
}
