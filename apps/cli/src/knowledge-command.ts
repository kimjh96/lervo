import { resolve } from "node:path";
import { parseArgs } from "node:util";
import {
  analyzeRepositoryKnowledgeImpact,
  createKnowledgeReconciliationPlan,
  createKnowledgeRefreshReviewCandidate,
  lintRepositoryKnowledge,
  queryRepositoryKnowledge,
  scanConfiguredRepositoryKnowledge,
} from "@lervo/repository-knowledge";
import { collectLocalKnowledgeSources } from "./knowledge-sources.js";
import { runKnowledgeCompilationCommand } from "./knowledge-compilation-command.js";
import { runDocumentNormalizationCommand } from "./document-normalization-command.js";
import { runDevelopmentPatternCommand } from "./development-pattern-command.js";
import { runImprovementEffectCommand } from "./improvement-effect-command.js";
import type { CliIo, CliServices } from "./types.js";
import { runKnowledgeInstruction } from "./knowledge-instruction-command.js";
import { runKnowledgeSemanticMaterialize } from "./knowledge-materialization-command.js";
import { runKnowledgeOkfExchange } from "./knowledge-okf-command.js";
import { runKnowledgeReview, runKnowledgeReviewPolicy } from "./knowledge-review-command.js";
import { runKnowledgeStructure } from "./knowledge-structure-command.js";
import { runKnowledgeMigration } from "./knowledge-migration-command.js";
import { knowledgeUsage } from "./knowledge-usage.js";
import { runKnowledgeCanonicalization } from "./knowledge-canonicalization-command.js";
export { runKnowledgeMigration } from "./knowledge-migration-command.js";
export { formatKnowledgeMigrationPlan } from "./knowledge-migration-format.js";
export { knowledgeUsage } from "./knowledge-usage.js";

export async function runKnowledgeCommand(
  args: string[],
  io: CliIo,
  services: Pick<
    CliServices,
    "createLocalImprovementObservationHost" | "improvementObservationPort"
  > = {},
): Promise<number> {
  const subcommand = args[0];
  if (subcommand === "export" || subcommand === "import" || subcommand === "okf")
    return runKnowledgeOkfExchange(args, io);
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
  if (
    subcommand === "compile" ||
    subcommand === "compare" ||
    subcommand === "stability" ||
    subcommand === "merge-candidate" ||
    subcommand === "fuzzy-merge-candidate"
  ) {
    return runKnowledgeCompilationCommand({
      operation: subcommand,
      args: args.slice(1),
      io,
      usage: knowledgeUsage,
    });
  }
  if (subcommand === "normalize") return runDocumentNormalizationCommand(args.slice(1), io);
  if (subcommand === "pattern" && args[1] === "effect")
    return runImprovementEffectCommand(args.slice(2), io, services);
  if (subcommand === "pattern") return runDevelopmentPatternCommand(args.slice(1), io);
  if (subcommand === "review-policy") return runKnowledgeReviewPolicy(args.slice(1), io);
  if (subcommand === "review") return runKnowledgeReview(args.slice(1), io);
  if (subcommand === "materialize") return runKnowledgeSemanticMaterialize(args.slice(1), io);
  if (subcommand === "structure") return runKnowledgeStructure(args.slice(1), io);
  if (subcommand === "instruction") return runKnowledgeInstruction(args.slice(1), io);
  if (subcommand === "reconcile") {
    try {
      const parsed = parseArgs({
        args: args.slice(1),
        strict: true,
        allowPositionals: true,
        options: { root: { type: "string" }, json: { type: "boolean" } },
      });
      if (parsed.positionals.length !== 1)
        throw new Error("reconcile requires one compilation ID.");
      const repositoryRoot = resolve(io.cwd, parsed.values.root ?? ".");
      const supplementalSources = await collectLocalKnowledgeSources(repositoryRoot);
      const plan = await createKnowledgeReconciliationPlan({
        repositoryRoot,
        compilationId: parsed.positionals[0] as string,
        supplementalSources,
      });
      const counts = new Map<string, number>();
      for (const item of plan.dispositions)
        counts.set(item.action, (counts.get(item.action) ?? 0) + 1);
      io.stdout(
        parsed.values.json
          ? `${JSON.stringify(plan, null, 2)}\n`
          : `Semantic candidate reconciliation: ${plan.status}\nplan: ${plan.reconciliationPlanId}\nregister existing ${counts.get("register_existing") ?? 0}, create generated ${counts.get("create_generated") ?? 0}, add relation ${counts.get("add_relation") ?? 0}, proposed user patch ${counts.get("propose_user_patch") ?? 0}, conflict ${counts.get("conflict") ?? 0}\nreview required ${plan.dispositions.filter((item) => item.review === "review_required").length}\nThis plan is read-only and did not change publications or candidate assurance.\n`,
      );
      return plan.status === "conflict" ? 1 : 0;
    } catch (error) {
      io.stderr(`${error instanceof Error ? error.message : String(error)}\n${knowledgeUsage}\n`);
      return 1;
    }
  }
  if (subcommand === "lint") {
    try {
      const parsed = parseArgs({
        args: args.slice(1),
        strict: true,
        allowPositionals: false,
        options: { root: { type: "string" }, json: { type: "boolean" } },
      });
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
      io.stderr(`${error instanceof Error ? error.message : String(error)}\n${knowledgeUsage}\n`);
      return 1;
    }
  }
  if (subcommand === "query") {
    try {
      const parsed = parseArgs({
        args: args.slice(1),
        strict: true,
        allowPositionals: true,
        options: { root: { type: "string" }, json: { type: "boolean" } },
      });
      const query = parsed.positionals.join(" ").trim();
      if (query === "") throw new Error("A query sentence is required.");
      const repositoryRoot = resolve(io.cwd, parsed.values.root ?? ".");
      const supplementalSources = await collectLocalKnowledgeSources(repositoryRoot);
      const result = await queryRepositoryKnowledge({ repositoryRoot, query, supplementalSources });
      io.stdout(
        parsed.values.json
          ? `${JSON.stringify(result, null, 2)}\n`
          : `Repository knowledge recommendations (${result.hits.length}; not evidence of loaded, injected, or used)\n${result.hits.map((hit) => `  ${hit.score.toString().padStart(2)}  ${hit.title} · ${hit.path} · ${hit.freshness}`).join("\n")}${result.hits.length === 0 ? "" : "\n"}`,
      );
      return 0;
    } catch (error) {
      io.stderr(`${error instanceof Error ? error.message : String(error)}\n${knowledgeUsage}\n`);
      return 1;
    }
  }
  io.stderr(`Specify a supported knowledge subcommand.\n${knowledgeUsage}\n`);
  return 1;
}
