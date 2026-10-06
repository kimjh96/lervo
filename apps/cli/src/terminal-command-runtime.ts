import { resolve } from "node:path";
import { parseArgs } from "node:util";

import { createTerminalCoverageReport } from "@lervo/diagnostics";
import { openProjectStorage, type ProjectStorage } from "@lervo/project-storage";
import { RepositoryKnowledgeError } from "@lervo/repository-knowledge";

import { foregroundKnowledgeMaterializationSettlement } from "./knowledge-materialization-wait.js";
import { formatTerminalCoverageReport } from "./terminal-coverage-format.js";
import { runTerminalBudgetCommand } from "./terminal-budget-command.js";
import { terminalUsage } from "./terminal-command-usage.js";
import { runTerminalDeclareCommand } from "./terminal-declaration-command.js";
import { runTerminalHookCommand } from "./terminal-hook-command.js";
import { inspectTerminalLifecycle } from "./terminal-lifecycle-inspection.js";
import { resolveTerminalRepositoryRoot } from "./terminal-repository-root.js";
import type { CliIo, CliServices } from "./types.js";

export { terminalUsage } from "./terminal-command-usage.js";
async function runCoverage(args: string[], io: CliIo): Promise<number> {
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
        json: { type: "boolean" },
      },
    });
    if (
      parsed.values.provider !== undefined &&
      parsed.values.provider !== "codex" &&
      parsed.values.provider !== "claude"
    )
      throw new Error("--provider must be codex or claude.");
    const limit = parsed.values.limit === undefined ? 20 : Number(parsed.values.limit);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100)
      throw new Error("--limit must be an integer between 1 and 100.");
    const root = await resolveTerminalRepositoryRoot(resolve(io.cwd, parsed.values.root ?? "."));
    storage = await openProjectStorage(root);
    const report = createTerminalCoverageReport({
      projectId: storage.manifest.projectId,
      events: storage.events,
      ...(parsed.values.provider === undefined ? {} : { provider: parsed.values.provider }),
      limit,
    });
    if (parsed.values.json) {
      io.stdout(`${JSON.stringify(report, null, 2)}\n`);
    } else {
      io.stdout(formatTerminalCoverageReport(report));
    }
    return 0;
  } catch (error) {
    io.stderr(`${error instanceof Error ? error.message : String(error)}\n${terminalUsage}\n`);
    return 1;
  } finally {
    await storage?.close();
  }
}

export async function runTerminalCommand(
  args: string[],
  io: CliIo,
  services: Pick<CliServices, "createTerminalStageObservation" | "projectSearchQueries">,
): Promise<number> {
  if (args[0] === "hook") return runTerminalHookCommand(args.slice(1), io, services);
  if (args[0] === "declare") return runTerminalDeclareCommand(args.slice(1), io);
  if (args[0] === "coverage") return runCoverage(args.slice(1), io);
  if (args[0] === "budget") return runTerminalBudgetCommand(args.slice(1), io);
  if (args[0] === "status") {
    let parsed;
    try {
      parsed = parseArgs({
        args: args.slice(1),
        strict: true,
        allowPositionals: false,
        options: { root: { type: "string" }, json: { type: "boolean" } },
      });
    } catch (error) {
      io.stderr(`${error instanceof Error ? error.message : String(error)}\n${terminalUsage}\n`);
      return 1;
    }
    try {
      const root = await resolveTerminalRepositoryRoot(resolve(io.cwd, parsed.values.root ?? "."));
      const result = await inspectTerminalLifecycle(
        root,
        undefined,
        foregroundKnowledgeMaterializationSettlement({ repositoryRoot: root, io }),
      );
      io.stdout(
        parsed.values.json
          ? `${JSON.stringify(result, null, 2)}\n`
          : [
              `Lervo terminal lifecycle: ${result.status}`,
              `Hook endpoint observation: ${result.runtimeActivation.status} (does not prove provider authorship)`,
              `Activation readiness: ${result.activationReadiness.status}`,
              ...result.issues.map(
                (item) =>
                  `  ${item.code}: ${item.detail === undefined ? "" : `${item.detail}; `}${item.command}`,
              ),
              ...result.activationReadiness.actions.map(
                (item) => `  ${item.provider} [${item.code}]: ${item.instruction}`,
              ),
              "",
            ].join("\n"),
      );
      return result.status === "current" && result.activationReadiness.status === "ready" ? 0 : 1;
    } catch (error) {
      io.stderr(
        error instanceof RepositoryKnowledgeError
          ? `Terminal lifecycle inspection failed: ${
              error.publicDiagnostic === undefined
                ? error.code
                : `${error.publicDiagnostic.code}: ${error.publicDiagnostic.message}`
            }\n`
          : "Terminal lifecycle inspection failed. Run lervo migrate knowledge, then lervo knowledge lint, and retry status.\n",
      );
      return 1;
    }
  }
  io.stderr(`Specify a supported terminal subcommand.\n${terminalUsage}\n`);
  return 1;
}
