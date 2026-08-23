import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { parseArgs } from "node:util";

import {
  applyDocumentNormalizationPlan,
  canonicalJson,
  compileConfiguredDocumentNormalizationCandidate,
  createDocumentNormalizationPlan,
  lintRepositoryKnowledge,
  loadDocumentNormalizationCandidate,
  RepositoryKnowledgeError,
  sha256,
  storeDocumentNormalizationCandidate,
  type DocumentNormalizationPlan,
} from "@lervo/repository-knowledge";
import { createProcessDocumentNormalizationCompiler } from "@lervo/repository-knowledge-compiler";
import { openProjectStorage } from "@lervo/project-storage";

import { collectLocalKnowledgeSources } from "./knowledge-sources.js";
import type { CliIo } from "./types.js";

const usage = "lervo knowledge normalize (--provider <codex|claude>|--candidate <candidate-id>) [--root <path>] [--model <model>] [--executable <path>] [--timeout-ms <ms>] [--apply <plan-id> --approve-item <operation-id>=<approval-hash>] [--json]";

function approvals(values: string[] | undefined): Array<{ operationId: string; approvalHash: string }> {
  return (values ?? []).map((value) => {
    const match = /^(knormop_[a-f0-9]{24})=(sha256:[a-f0-9]{64})$/u.exec(value);
    if (match === null) throw new Error("--approve-item must use <normalization-operation-id>=<approval-hash>.");
    return { operationId: match[1]!, approvalHash: match[2]! };
  });
}

function printablePlan(plan: DocumentNormalizationPlan, artifactPath: string): unknown {
  return {
    ...plan,
    candidateArtifactPath: artifactPath,
    items: plan.items.map((item) => ({
      ...item,
      outputs: item.outputs.map(({ content: _content, ...output }) => output),
    })),
    operations: plan.operations.map((operation) => {
      const { content: _content, ...output } = operation as typeof operation & { content?: string };
      return output;
    }),
  };
}

function formatPlan(plan: DocumentNormalizationPlan, artifactPath: string): string {
  const lines = [
    `Repository document normalization: ${plan.status}`,
    `plan: ${plan.planId}`,
    `candidate: ${plan.candidateId ?? "none"}`,
    `candidate artifact: ${artifactPath}`,
    `language: ${plan.outputLanguage} · format: ${plan.formatVersion}`,
    `source documents: ${plan.items.length} · output documents: ${plan.items.reduce((sum, item) => sum + item.outputs.length, 0)}`,
  ];
  for (const item of plan.items) {
    lines.push(`  ${item.sourcePath} (${item.profile})`);
    for (const output of item.outputs) lines.push(`    -> ${output.path} · ${output.byteCount} bytes · ${output.contentHash}`);
    lines.push(`    approval: ${item.operationId}=${item.approvalHash}`);
  }
  for (const blocker of plan.blockers) lines.push(`  blocker [${blocker.code}] ${blocker.path}`);
  if (plan.status === "review_required") lines.push("No repository document has been changed. Review the stored candidate bytes, then apply this plan with every displayed approval.");
  return `${lines.join("\n")}\n`;
}

export async function runDocumentNormalizationCommand(args: string[], io: CliIo): Promise<number> {
  try {
    const parsed = parseArgs({
      args,
      strict: true,
      allowPositionals: false,
      options: {
        root: { type: "string" },
        provider: { type: "string" },
        candidate: { type: "string" },
        model: { type: "string" },
        executable: { type: "string" },
        "timeout-ms": { type: "string" },
        apply: { type: "string" },
        "approve-item": { type: "string", multiple: true },
        json: { type: "boolean" },
        help: { type: "boolean", short: "h" },
      },
    });
    if (parsed.values.help) { io.stdout(`${usage}\n`); return 0; }
    if ((parsed.values.provider === undefined) === (parsed.values.candidate === undefined)) throw new Error("Specify exactly one of --provider or --candidate.");
    if (parsed.values.provider !== undefined && parsed.values.provider !== "codex" && parsed.values.provider !== "claude") throw new Error("--provider must be codex or claude.");
    if (parsed.values.apply !== undefined && parsed.values.candidate === undefined) throw new Error("Applying normalization requires the stored --candidate ID shown by the planning command.");
    const timeoutMs = parsed.values["timeout-ms"] === undefined ? undefined : Number(parsed.values["timeout-ms"]);
    if (timeoutMs !== undefined && (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 600_000)) throw new Error("--timeout-ms must be an integer between 1000 and 600000.");
    const repositoryRoot = resolve(io.cwd, parsed.values.root ?? ".");
    const supplementalSources = await collectLocalKnowledgeSources(repositoryRoot);
    let candidate;
    let stored;
    if (parsed.values.provider !== undefined) {
      const compiler = await createProcessDocumentNormalizationCompiler({
        provider: parsed.values.provider,
        ...(parsed.values.model === undefined ? {} : { model: parsed.values.model }),
        ...(parsed.values.executable === undefined ? {} : { executable: parsed.values.executable }),
        ...(timeoutMs === undefined ? {} : { timeoutMs }),
      });
      const controller = new AbortController();
      const abort = (): void => controller.abort(new Error("document normalization cancelled"));
      process.once("SIGINT", abort);
      process.once("SIGTERM", abort);
      try {
        candidate = await compileConfiguredDocumentNormalizationCandidate({
          repositoryRoot,
          compiler,
          signal: controller.signal,
          supplementalSources,
          onShardProgress: ({ index, total, status }) => {
            if (parsed.values.json) return;
            if (status === "started") io.stderr(`normalization shard ${index}/${total}: started\n`);
            if (status === "cache_hit") io.stderr(`normalization shard ${index}/${total}: reused cached result\n`);
            if (status === "completed") io.stderr(`normalization shard ${index}/${total}: completed\n`);
          },
        });
      } finally {
        process.off("SIGINT", abort);
        process.off("SIGTERM", abort);
      }
      stored = await storeDocumentNormalizationCandidate({ repositoryRoot, candidate });
    } else {
      candidate = await loadDocumentNormalizationCandidate({ repositoryRoot, candidateId: parsed.values.candidate! });
      stored = { candidateId: candidate.candidateId, artifactPath: `.lervo/state/knowledge/normalization-candidates/${candidate.candidateId.slice("knorm_".length, "knorm_".length + 2)}/${candidate.candidateId}.json`, artifactHash: "", created: false };
    }
    const plan = await createDocumentNormalizationPlan({ repositoryRoot, candidate, now: new Date(), supplementalSources });
    if (parsed.values.apply === undefined) {
      if ((parsed.values["approve-item"]?.length ?? 0) > 0) throw new Error("--approve-item must be used with --apply.");
      io.stdout(parsed.values.json ? `${JSON.stringify(printablePlan(plan, stored.artifactPath), null, 2)}\n` : formatPlan(plan, stored.artifactPath));
      return plan.status === "blocked" ? 1 : 0;
    }
    if (parsed.values.apply !== plan.planId) throw new Error("The requested plan ID does not match the current document normalization plan.");
    const storage = await openProjectStorage(repositoryRoot);
    try {
      const eventIdentity = randomUUID().replaceAll("-", "");
      const receipt = await applyDocumentNormalizationPlan({
        plan,
        candidate,
        approvals: approvals(parsed.values["approve-item"]),
        now: new Date(),
        supplementalSources,
        recordApplied: async (applied) => {
          const validation = await lintRepositoryKnowledge(repositoryRoot, { supplementalSources, allowTransactionPlanId: plan.planId });
          const rewritesBridgeInputs = plan.items.some((item) => item.sourcePath === "AGENTS.md" || item.sourcePath === "CLAUDE.md");
          const expectedTransitionCodes = new Set(rewritesBridgeInputs ? ["instruction_bridge_binding_stale"] : []);
          const blockingIssues = validation.issues.filter((issue) => issue.severity === "error" && !expectedTransitionCodes.has(issue.code));
          if (blockingIssues.length > 0) {
            const summary = blockingIssues.slice(0, 20).map((issue) => `${issue.code}:${issue.path}`).join(", ");
            throw new RepositoryKnowledgeError("knowledge_lint_failed", `Deterministic lint failed after document normalization: ${summary}`);
          }
          const stageValidation = {
            ...validation,
            valid: true,
            issues: validation.issues.map((issue) => expectedTransitionCodes.has(issue.code)
              ? { ...issue, severity: "warning" as const, message: `${issue.message} Expected until the immediate instruction-bridge refresh.` }
              : issue),
          };
          const validationHash = sha256(canonicalJson(stageValidation));
          await storage.artifacts.put(canonicalJson(stageValidation));
          storage.events.append({
            eventId: `evt_${eventIdentity}`,
            projectId: plan.projectId,
            runId: `run_${eventIdentity}`,
            sessionId: `ses_${eventIdentity}`,
            type: "knowledge.materialization.applied",
            occurredAt: applied.appliedAt,
            actor: { kind: "system" },
            schemaVersion: 1,
            policyVersion: sha256(canonicalJson({ outputLanguage: plan.outputLanguage, formatVersion: plan.formatVersion })),
            payload: {
              operation: "normalize_documents",
              planId: plan.planId,
              sourceSnapshotId: plan.sourceSnapshotId,
              policyHash: sha256(canonicalJson({ outputLanguage: plan.outputLanguage, formatVersion: plan.formatVersion })),
              compilerId: candidate.compiler.compilerId,
              compilerVersion: candidate.compiler.compilerVersion,
              compilerBuildId: candidate.compiler.compilerBuildId,
              approvalDigest: applied.approvalDigest,
              coverage: candidate.coverage,
              bundleIds: [], createdConceptIds: [], updatedConceptIds: [], deprecatedConceptIds: [], conceptListTruncated: false,
              resultArtifactId: null, resultArtifactHash: null,
              createdCount: applied.created.length,
              updatedCount: applied.updated.length,
              unchangedCount: 0,
              deletedCount: applied.deleted.length,
              beforeRegistryDigest: sha256(canonicalJson(plan.items.map((item) => ({ pathDigest: sha256(item.sourcePath), hash: item.sourceContentHash })))),
              afterRegistryDigest: sha256(canonicalJson(plan.items.flatMap((item) => item.outputs.map((output) => ({ pathDigest: sha256(output.path), hash: output.contentHash }))))),
              validationReportId: `klint_${validationHash.slice("sha256:".length, "sha256:".length + 24)}`,
              validationReportHash: validationHash,
              appliedAt: applied.appliedAt,
            },
          });
        },
      });
      io.stdout(parsed.values.json ? `${JSON.stringify(receipt, null, 2)}\n` : `Repository documents normalized.\nplan: ${receipt.planId}\nsource documents: ${receipt.normalizedDocumentCount}\noutput documents: ${receipt.outputDocumentCount}\nRun lervo migrate knowledge again to refresh structural navigation.\n`);
      return 0;
    } finally { await storage.close(); }
  } catch (error) {
    io.stderr(`${error instanceof Error ? error.message : String(error)}\n${usage}\n`);
    return 1;
  }
}
