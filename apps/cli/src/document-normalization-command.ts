import { randomUUID } from "node:crypto";
import { resolve } from "node:path";

import {
  applyDocumentNormalizationPlan,
  canonicalJson,
  compileConfiguredDocumentNormalizationCandidateObserved,
  createConfiguredDocumentNormalizationPreflight,
  createDocumentNormalizationPlan,
  lintRepositoryKnowledge,
  loadDocumentNormalizationCandidate,
  sha256,
  storeDocumentNormalizationCandidate,
  type DocumentNormalizationPlan,
  type DocumentNormalizationResourceObservation,
} from "@lervo/repository-knowledge";
import { createProcessDocumentNormalizationCompiler } from "@lervo/repository-knowledge-compiler";
import { openProjectStorage } from "@lervo/project-storage";
import {
  lifecycleChangedPaths,
  noCapabilityJsonInvocationStrategy,
} from "@lervo/repository-knowledge-runtime";

import { collectLocalKnowledgeSources } from "./knowledge-sources.js";
import {
  documentNormalizationUsage,
  parseDocumentNormalizationOptions,
} from "./document-normalization-options.js";
import { formatDocumentNormalizationPreflight } from "./document-normalization-preflight-format.js";
import type { CliIo, CliServices } from "./types.js";
import { normalizationKnowledgeLintCodes, validateKnowledgeStage } from "./knowledge-stage-lint.js";
import { applyCrossCheckedEffect, crossCheckedEffectLines } from "./cross-checked-effect.js";
import { crossCheckPlan } from "./plan-cross-check.js";

function printablePlan(
  plan: DocumentNormalizationPlan,
  artifactPath: string,
  resourceObservation?: DocumentNormalizationResourceObservation,
): unknown {
  return {
    ...plan,
    candidateArtifactPath: artifactPath,
    ...(resourceObservation === undefined ? {} : { resourceObservation }),
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

function formatPlan(
  plan: DocumentNormalizationPlan,
  artifactPath: string,
  resourceObservation?: DocumentNormalizationResourceObservation,
): string {
  const lines = [
    `Repository document normalization: ${plan.status}`,
    `plan: ${plan.planId}`,
    `candidate: ${plan.candidateId ?? "none"}`,
    `candidate artifact: ${artifactPath}`,
    `workset: ${plan.workset.worksetId} · scope: ${plan.workset.scope}`,
    `selection mode: ${plan.workset.selection?.kind ?? "complete_scope"}`,
    `language: ${plan.outputLanguage} · format: ${plan.formatVersion}`,
    `source documents: ${plan.items.length} · output documents: ${plan.items.reduce((sum, item) => sum + item.outputs.length, 0)}`,
  ];
  if (resourceObservation !== undefined) {
    lines.push(
      `provider calls: ${resourceObservation.providerCalls} · elapsed: ${resourceObservation.elapsedMilliseconds} ms`,
    );
    lines.push(
      resourceObservation.tokenUsage.status === "observed"
        ? `tokens: ${resourceObservation.tokenUsage.totalTokens} total (${resourceObservation.tokenUsage.inputTokens} input, ${resourceObservation.tokenUsage.cachedInputTokens} cached input, ${resourceObservation.tokenUsage.outputTokens} output)`
        : `tokens: unavailable (${resourceObservation.tokenUsage.unavailableProviderCalls}/${resourceObservation.providerCalls} provider calls unavailable)`,
    );
  }
  for (const item of plan.items) {
    lines.push(`  ${item.sourcePath} (${item.profile})`);
    for (const output of item.outputs)
      lines.push(`    -> ${output.path} · ${output.byteCount} bytes · ${output.contentHash}`);
  }
  for (const blocker of plan.blockers) lines.push(`  blocker [${blocker.code}] ${blocker.path}`);
  if (plan.status === "review_required")
    lines.push(
      `No repository document has been changed. Apply with --candidate ${plan.candidateId} --apply ${plan.planId}; an independent cross-check reviews the stored candidate bytes first, and the commit it creates is the undo point.`,
    );
  return `${lines.join("\n")}\n`;
}

export async function runDocumentNormalizationCommand(
  args: string[],
  io: CliIo,
  services: Partial<Pick<CliServices, "crossCheckPlan">> = {},
): Promise<number> {
  try {
    const options = parseDocumentNormalizationOptions(args);
    if (options.help) {
      io.stdout(`${documentNormalizationUsage}\n`);
      return 0;
    }
    const repositoryRoot = resolve(io.cwd, options.root ?? ".");
    const supplementalSources = await collectLocalKnowledgeSources(repositoryRoot);
    let candidate;
    let stored;
    let resourceObservation: DocumentNormalizationResourceObservation | undefined;
    if (options.provider !== undefined) {
      const compiler = await createProcessDocumentNormalizationCompiler({
        strategy: noCapabilityJsonInvocationStrategy(options.provider),
        ...(options.model === undefined ? {} : { model: options.model }),
        ...(options.executable === undefined ? {} : { executable: options.executable }),
        ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
      });
      if (options.preflight) {
        const preflight = await createConfiguredDocumentNormalizationPreflight({
          repositoryRoot,
          compiler,
          scope: options.scope,
          ...(options.sourcePaths === undefined ? {} : { sourcePaths: options.sourcePaths }),
          ceilings: options.ceilings,
          supplementalSources,
        });
        io.stdout(
          options.json
            ? `${JSON.stringify(preflight, null, 2)}\n`
            : formatDocumentNormalizationPreflight(preflight),
        );
        return preflight.status === "blocked" ? 1 : 0;
      }
      const controller = new AbortController();
      const abort = (): void => controller.abort(new Error("document normalization cancelled"));
      process.once("SIGINT", abort);
      process.once("SIGTERM", abort);
      try {
        const compilation = await compileConfiguredDocumentNormalizationCandidateObserved({
          repositoryRoot,
          compiler,
          signal: controller.signal,
          scope: options.scope,
          ...(options.sourcePaths === undefined ? {} : { sourcePaths: options.sourcePaths }),
          ceilings: options.ceilings,
          supplementalSources,
          onShardProgress: ({ index, total, status, documentCount, cachedDocumentCount }) => {
            const documents = `${documentCount} document${documentCount === 1 ? "" : "s"}`;
            if (status === "started")
              io.stderr(`normalization shard ${index}/${total}: started (${documents})\n`);
            if (status === "cache_hit")
              io.stderr(
                `normalization shard ${index}/${total}: reused ${cachedDocumentCount} cached document${cachedDocumentCount === 1 ? "" : "s"}\n`,
              );
            if (status === "split_retry")
              io.stderr(
                `normalization shard ${index}/${total}: retrying ${documents} individually\n`,
              );
            if (status === "completed")
              io.stderr(
                `normalization shard ${index}/${total}: completed (${cachedDocumentCount} cached, ${documentCount - cachedDocumentCount} generated)\n`,
              );
          },
        });
        candidate = compilation.candidate;
        resourceObservation = compilation.resourceObservation;
      } finally {
        process.off("SIGINT", abort);
        process.off("SIGTERM", abort);
      }
      stored = await storeDocumentNormalizationCandidate({ repositoryRoot, candidate });
    } else {
      candidate = await loadDocumentNormalizationCandidate({
        repositoryRoot,
        candidateId: options.candidate!,
      });
      stored = {
        candidateId: candidate.candidateId,
        artifactPath: `.lervo/state/knowledge/normalization-candidates/${candidate.candidateId.slice("knorm_".length, "knorm_".length + 2)}/${candidate.candidateId}.json`,
        artifactHash: "",
        created: false,
      };
    }
    const plan = await createDocumentNormalizationPlan({
      repositoryRoot,
      candidate,
      now: new Date(),
      supplementalSources,
    });
    if (options.apply === undefined) {
      io.stdout(
        options.json
          ? `${JSON.stringify(printablePlan(plan, stored.artifactPath, resourceObservation), null, 2)}\n`
          : formatPlan(plan, stored.artifactPath, resourceObservation),
      );
      return plan.status === "blocked" ? 1 : 0;
    }
    if (options.apply !== plan.planId)
      throw new Error(
        "The requested plan ID does not match the current document normalization plan.",
      );
    const baselineValidation = await lintRepositoryKnowledge(repositoryRoot, {
      supplementalSources,
    });
    const storage = await openProjectStorage(repositoryRoot);
    try {
      const eventIdentity = randomUUID().replaceAll("-", "");
      const { receipt, report } = await applyCrossCheckedEffect({
        crossCheckPlan: services.crossCheckPlan ?? crossCheckPlan,
        repositoryRoot,
        ...(options.crossCheckProvider === undefined
          ? {}
          : { provider: options.crossCheckProvider }),
        plan,
        paths: lifecycleChangedPaths(plan),
        notice: {
          effect: "document_normalization",
          planId: plan.planId,
          reason: `normalized ${plan.items.length} documents to ${plan.outputLanguage} ${plan.formatVersion}`,
        },
        apply: () =>
          applyDocumentNormalizationPlan({
            plan,
            candidate,
            // The plan's own content bindings; the cross-check above agreed with these exact bytes.
            approvals: plan.items.map(({ operationId, approvalHash }) => ({
              operationId,
              approvalHash,
            })),
            now: new Date(),
            supplementalSources,
            recordApplied: async (applied) => {
              const observedValidation = await lintRepositoryKnowledge(repositoryRoot, {
                supplementalSources,
                allowTransactionPlanId: plan.planId,
              });
              const rewritesBridgeInputs = plan.items.some(
                (item) => item.sourcePath === "AGENTS.md" || item.sourcePath === "CLAUDE.md",
              );
              const expectedTransitionCodes = new Set(
                rewritesBridgeInputs ? ["instruction_bridge_binding_stale"] : [],
              );
              const stageValidation = validateKnowledgeStage({
                stage: "document normalization",
                before: baselineValidation,
                after: observedValidation,
                ownedErrorCodes: normalizationKnowledgeLintCodes,
                rejectNewBrokenLinksIn: new Set(
                  plan.operations
                    .filter(
                      (operation) =>
                        operation.action !== "delete" && operation.action !== "unchanged",
                    )
                    .map((operation) => operation.path),
                ),
                expectedTransitionCodes,
              });
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
                policyVersion: sha256(
                  canonicalJson({
                    outputLanguage: plan.outputLanguage,
                    formatVersion: plan.formatVersion,
                  }),
                ),
                payload: {
                  operation: "normalize_documents",
                  planId: plan.planId,
                  sourceSnapshotId: plan.sourceSnapshotId,
                  policyHash: sha256(
                    canonicalJson({
                      outputLanguage: plan.outputLanguage,
                      formatVersion: plan.formatVersion,
                    }),
                  ),
                  compilerId: candidate.compiler.compilerId,
                  compilerVersion: candidate.compiler.compilerVersion,
                  compilerBuildId: candidate.compiler.compilerBuildId,
                  approvalDigest: applied.approvalDigest,
                  coverage: { ...candidate.coverage, workset: candidate.workset },
                  bundleIds: [],
                  createdConceptIds: [],
                  updatedConceptIds: [],
                  deprecatedConceptIds: [],
                  conceptListTruncated: false,
                  resultArtifactId: null,
                  resultArtifactHash: null,
                  createdCount: applied.created.length,
                  updatedCount: applied.updated.length,
                  unchangedCount: 0,
                  deletedCount: applied.deleted.length,
                  beforeRegistryDigest: sha256(
                    canonicalJson(
                      plan.items.map((item) => ({
                        pathDigest: sha256(item.sourcePath),
                        hash: item.sourceContentHash,
                      })),
                    ),
                  ),
                  afterRegistryDigest: sha256(
                    canonicalJson(
                      plan.items.flatMap((item) =>
                        item.outputs.map((output) => ({
                          pathDigest: sha256(output.path),
                          hash: output.contentHash,
                        })),
                      ),
                    ),
                  ),
                  validationReportId: `klint_${validationHash.slice("sha256:".length, "sha256:".length + 24)}`,
                  validationReportHash: validationHash,
                  appliedAt: applied.appliedAt,
                },
              });
            },
          }),
      });
      io.stdout(
        options.json
          ? `${JSON.stringify({ ...receipt, notice: report }, null, 2)}\n`
          : `Repository documents normalized.\nplan: ${receipt.planId}\nsource documents: ${receipt.normalizedDocumentCount}\noutput documents: ${receipt.outputDocumentCount}\n${crossCheckedEffectLines(report).join("\n")}\nRun lervo migrate knowledge again to refresh structural navigation.\n`,
      );
      return 0;
    } finally {
      await storage.close();
    }
  } catch (error) {
    io.stderr(
      `${error instanceof Error ? error.message : String(error)}\n${documentNormalizationUsage}\n`,
    );
    return 1;
  }
}
