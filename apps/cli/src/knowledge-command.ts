import { runKnowledgeQuery } from "./knowledge-query-command.js";
import { runKnowledgeConvergenceCommand } from "./knowledge-convergence-command.js";
import { resolve } from "node:path";
import { runHostKnowledgeResidentsCommand } from "./knowledge-host-resident-command.js";
import { runKnowledgeWorkerCommand } from "./knowledge-worker-command.js";
import { parseArgs } from "node:util";
import {
  analyzeRepositoryKnowledgeImpact,
  createKnowledgeRefreshReviewCandidate,
  lintRepositoryKnowledge,
  scanConfiguredRepositoryKnowledge,
} from "@lervo/repository-knowledge";
import { collectLocalKnowledgeSources } from "./knowledge-sources.js";
import { runDocumentNormalizationCommand } from "./document-normalization-command.js";
import type { CliIo, CliServices } from "./types.js";
import { runKnowledgeInstruction } from "./knowledge-instruction-command.js";
import { runKnowledgeMaterializationRecovery } from "./knowledge-materialization-command.js";
import { runKnowledgeOkfExchange } from "./knowledge-okf-command.js";
import { runKnowledgeStructure } from "./knowledge-structure-command.js";
import { runKnowledgeFreshness } from "./knowledge-freshness-command.js";
import { writeCommandError } from "./command-error-output.js";
import { foregroundKnowledgeMaterializationSettlement } from "./knowledge-materialization-wait.js";
import { runKnowledgeMigration } from "./knowledge-migration-command.js";
import { knowledgeUsage } from "./knowledge-usage.js";
import { runKnowledgeCanonicalization } from "./knowledge-canonicalization-command.js";
export { runKnowledgeMigration } from "./knowledge-migration-command.js";
export { formatKnowledgeMigrationPlan } from "./knowledge-migration-format.js";
export { knowledgeUsage } from "./knowledge-usage.js";

/**
 * The resident worker and convergence status own their marker handling, and migration settles
 * inside `runKnowledgeMigration`; every other subcommand waits for a live owner first.
 */
const SELF_SETTLING_SUBCOMMANDS = new Set(["worker", "convergence", "refresh"]);

function knowledgeCommandRoot(args: string[], cwd: string): string {
  const index = args.indexOf("--root");
  const inline = args.find((arg) => arg.startsWith("--root="));
  return resolve(
    cwd,
    (index >= 0 ? args[index + 1] : undefined) ?? inline?.slice("--root=".length) ?? ".",
  );
}

export async function runKnowledgeCommand(
  args: string[],
  io: CliIo,
  services: Partial<
    Pick<CliServices, "groundProductionRequest" | "knowledgeMaterializationWait">
  > = {},
): Promise<number> {
  const subcommand = args[0];
  if (subcommand !== undefined && !SELF_SETTLING_SUBCOMMANDS.has(subcommand)) {
    try {
      await foregroundKnowledgeMaterializationSettlement({
        repositoryRoot: knowledgeCommandRoot(args, io.cwd),
        io,
        timing: services.knowledgeMaterializationWait,
      }).settle();
    } catch (error) {
      writeCommandError(io, error, { json: args.includes("--json") });
      return 1;
    }
  }
  if (subcommand === "export" || subcommand === "import" || subcommand === "okf")
    return runKnowledgeOkfExchange(args, io);
  if (subcommand === "convergence") return runKnowledgeConvergenceCommand(args.slice(1), io);
  if (subcommand === "worker")
    return args.includes("--host")
      ? runHostKnowledgeResidentsCommand(args.slice(1), io)
      : runKnowledgeWorkerCommand(args.slice(1), io);
  if (subcommand === "refresh")
    return runKnowledgeMigration({ args: args.slice(1), io, mode: "refresh" });
  if (subcommand === "canonicalization") return runKnowledgeCanonicalization(args.slice(1), io);
  if (subcommand === "impact") {
    try {
      const parsed = parseArgs({
        args: args.slice(1),
        strict: true,
        allowPositionals: false,
        options: { root: { type: "string" }, json: { type: "boolean" } },
      });
      const repositoryRoot = resolve(io.cwd, parsed.values.root ?? ".");
      const supplementalSources = await collectLocalKnowledgeSources(repositoryRoot);
      const { scan } = await scanConfiguredRepositoryKnowledge(repositoryRoot, {
        supplementalSources,
      });
      const report = await analyzeRepositoryKnowledgeImpact({ repositoryRoot, scan });
      io.stdout(
        parsed.values.json
          ? `${JSON.stringify(report, null, 2)}\n`
          : `Repository knowledge impact: ${report.status} · current ${report.summary.current} · stale ${report.summary.stale} · unknown ${report.summary.unknown} · affected concepts ${report.summary.affectedConcepts}\nreport: ${report.reportId} · source snapshot: ${report.sourceSnapshotId} · lineage ${report.lineageComplete ? "complete" : "incomplete"}\n${report.items
              .filter((item) => item.freshness !== "current")
              .map(
                (item) =>
                  `  ${item.freshness} ${item.subjectKind}:${item.subjectId} · ${item.reasons.join(", ")}`,
              )
              .join(
                "\n",
              )}${report.items.every((item) => item.freshness === "current") ? "" : "\n"}`,
      );
      return 0;
    } catch (error) {
      io.stderr(`${error instanceof Error ? error.message : String(error)}\n${knowledgeUsage}\n`);
      return 1;
    }
  }
  if (subcommand === "refresh-candidate") {
    try {
      const parsed = parseArgs({
        args: args.slice(1),
        strict: true,
        allowPositionals: false,
        options: { root: { type: "string" }, json: { type: "boolean" } },
      });
      const repositoryRoot = resolve(io.cwd, parsed.values.root ?? ".");
      const supplementalSources = await collectLocalKnowledgeSources(repositoryRoot);
      const { scan } = await scanConfiguredRepositoryKnowledge(repositoryRoot, {
        supplementalSources,
      });
      const report = await analyzeRepositoryKnowledgeImpact({ repositoryRoot, scan });
      const candidate = createKnowledgeRefreshReviewCandidate(report);
      io.stdout(
        parsed.values.json
          ? `${JSON.stringify(candidate, null, 2)}\n`
          : `Repository knowledge refresh review candidate: ${candidate.status} · items ${candidate.items.length}\ncandidate: ${candidate.candidateId} · impact: ${candidate.impactReportId}\n${candidate.items.map((item) => `  ${item.proposedAction} ${item.subjectKind}:${item.subjectId} · ${item.observedFreshness} · ${item.reasons.join(", ")}`).join("\n")}${candidate.items.length === 0 ? "" : "\n"}Publications were not changed automatically.\n`,
      );
      return 0;
    } catch (error) {
      io.stderr(`${error instanceof Error ? error.message : String(error)}\n${knowledgeUsage}\n`);
      return 1;
    }
  }
  if (subcommand === "normalize") return runDocumentNormalizationCommand(args.slice(1), io);
  if (subcommand === "materialize") return runKnowledgeMaterializationRecovery(args.slice(1), io);
  if (subcommand === "structure") return runKnowledgeStructure(args.slice(1), io);
  if (subcommand === "freshness") return runKnowledgeFreshness(args.slice(1), io);
  if (subcommand === "instruction") {
    return runKnowledgeInstruction(
      args.slice(1),
      io,
      services.groundProductionRequest === undefined
        ? undefined
        : { groundProductionRequest: services.groundProductionRequest },
    );
  }
  if (subcommand === "lint") {
    let json = false;
    try {
      const parsed = parseArgs({
        args: args.slice(1),
        strict: true,
        allowPositionals: false,
        options: { root: { type: "string" }, json: { type: "boolean" } },
      });
      json = parsed.values.json === true;
      const repositoryRoot = resolve(io.cwd, parsed.values.root ?? ".");
      const supplementalSources = await collectLocalKnowledgeSources(repositoryRoot);
      const result = await lintRepositoryKnowledge(repositoryRoot, { supplementalSources });
      io.stdout(
        parsed.values.json
          ? `${JSON.stringify(result, null, 2)}\n`
          : `Repository knowledge lint: ${result.valid ? "passed" : "failed"} · concept ${result.checkedConcepts} · error ${result.issues.filter((item) => item.severity === "error").length} · warning ${result.issues.filter((item) => item.severity === "warning").length}\n${result.issues.map((item) => `  ${item.severity} [${item.code}] ${item.path}: ${item.message}`).join("\n")}${result.issues.length === 0 ? "" : "\n"}`,
      );
      return result.valid ? 0 : 1;
    } catch (error) {
      if (json) writeCommandError(io, error, { json });
      else
        io.stderr(`${error instanceof Error ? error.message : String(error)}\n${knowledgeUsage}\n`);
      return 1;
    }
  }
  if (subcommand === "query") return runKnowledgeQuery(args.slice(1), io);
  io.stderr(`Specify a supported knowledge subcommand.\n${knowledgeUsage}\n`);
  return 1;
}
