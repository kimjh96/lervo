import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { repositoryStatusDigest } from "./linked-evidence-provider-shadow-pilot-preparation.mjs";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function monitoredAdapter(adapter, telemetry) {
  return new Proxy(adapter, {
    get(target, property) {
      if (property === "events") {
        return async function* events(session, signal) {
          for await (const event of target.events(session, signal)) {
            if (event.type === "provider.usage.updated") {
              telemetry.usage = {
                inputTokens: event.payload.inputTokens,
                cachedInputTokens: event.payload.cachedInputTokens,
                outputTokens: event.payload.outputTokens,
                reasoningOutputTokens: event.payload.reasoningOutputTokens,
                totalTokens: event.payload.totalTokens,
              };
            }
            yield event;
          }
        };
      }
      if (property === "start") {
        return async (...arguments_) => {
          telemetry.providerStarts += 1;
          return target.start(...arguments_);
        };
      }
      if (property === "getTurnResult") {
        return async (...arguments_) => {
          const result = await target.getTurnResult(...arguments_);
          telemetry.rawResult = result.content;
          return result;
        };
      }
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

function idFactory(runId) {
  const counters = new Map();
  return (prefix) => {
    if (prefix === "run") return runId;
    const count = (counters.get(prefix) ?? 0) + 1;
    counters.set(prefix, count);
    return `${prefix}_${createHash("sha256")
      .update(`${runId}:${prefix}:${count}`)
      .digest("hex")
      .slice(0, 32)}`;
  };
}

function scoreAnswer(rawResult, sourceCase, registry, referencedDocumentIds) {
  const normalized = rawResult.normalize("NFKC").toLocaleLowerCase("en-US");
  const referenced = new Set(referencedDocumentIds);
  const sourceChecks = sourceCase.expectedPaths.map((path) => {
    const documentId = Object.entries(registry.documents).find(
      ([, document]) => document.path === path,
    )?.[0];
    return {
      path,
      passed: normalized.includes(path.toLocaleLowerCase("en-US")) || referenced.has(documentId),
    };
  });
  const claimChecks = sourceCase.claims.map((claim) => ({
    claimId: claim.claimId,
    passed: claim.anyOf.some((pattern) => new RegExp(pattern, "iu").test(normalized)),
  }));
  const sourcePassed = sourceChecks.filter((item) => item.passed).length;
  const claimPassed = claimChecks.filter((item) => item.passed).length;
  return {
    sourceChecks,
    claimChecks,
    sourceRecall: sourcePassed / sourceChecks.length,
    claimRecall: claimPassed / claimChecks.length,
    complete: sourcePassed === sourceChecks.length && claimPassed === claimChecks.length,
  };
}

async function selectedByteCount(repositoryRoot, selections) {
  const sizes = await Promise.all(
    selections.map(async (selection) =>
      Buffer.byteLength(await readFile(resolve(repositoryRoot, selection.path))),
    ),
  );
  return sizes.reduce((sum, size) => sum + size, 0);
}

export async function executeLexicalLinkedUpliftTask(input) {
  const [managedRun, defaultSelection, codex, claude, project, storage] = await Promise.all([
    import("../../apps/cli/dist/managed-run.js"),
    import("../../apps/cli/dist/managed-linked-evidence-default-selection.js"),
    import("../../packages/adapter-codex/dist/index.js"),
    import("../../packages/adapter-claude/dist/index.js"),
    import("../../packages/project/dist/index.js"),
    import("../../packages/project-storage/dist/index.js"),
  ]);
  const registry = await project.loadDocumentRegistry(input.repositoryRoot);
  const expectedPath = input.sourceCase.expectedPaths[0];
  assert(
    Object.values(registry.documents).some((document) => document.path === expectedPath),
    "lexical_linked_uplift_expected_path_missing",
  );
  const telemetry = {
    usage: null,
    rawResult: "",
    adapterCreations: 0,
    providerStarts: 0,
    linkedSelections: [],
  };
  const beforeStatusDigest = repositoryStatusDigest(input.repositoryRoot);
  const started = performance.now();
  const execute = managedRun.createManagedRunExecutor({
    openStorage: storage.openProjectStorage,
    createId: idFactory(input.runId),
    now: () => new Date(input.observedAt),
    createSearchNonce: () => input.searchNonce,
    semanticEvaluator: {
      async evaluate(request) {
        return {
          evaluator: { kind: "model", evaluatorId: "lexical-linked-uplift.fixed.v1" },
          checks: request.checks.map((check) => ({
            checkId: check.checkId,
            status: "passed",
            violationCount: 0,
          })),
        };
      },
    },
    resolveExperimentalLinkedEvidenceSelection: async (selectionInput) => {
      const selections =
        await defaultSelection.resolveDefaultManagedLinkedEvidenceSelection(selectionInput);
      telemetry.linkedSelections = selections;
      return input.arm === "lexical_plus_linked" ? selections : [];
    },
    createAdapter: (adapterInput) => {
      telemetry.adapterCreations += 1;
      assert(adapterInput.selectionBoundary === undefined, "uplift_selection_adapter_created");
      const adapter =
        adapterInput.provider === "codex"
          ? new codex.CodexAdapter({
              repositoryRoot: adapterInput.repositoryRoot,
              resolveArtifact: adapterInput.resolveArtifact,
              model: "gpt-5.6-sol",
              sandbox: "read-only",
              approvalPolicy: "never",
            })
          : new claude.ClaudeAdapter({
              repositoryRoot: adapterInput.repositoryRoot,
              resolveArtifact: adapterInput.resolveArtifact,
              model: "opus",
              permissionMode: "plan",
            });
      return monitoredAdapter(adapter, telemetry);
    },
    groundProductionRequest: async () => ({
      decision: { status: "ready", capabilityIds: [] },
    }),
  });
  try {
    const outcome = await execute({
      repositoryRoot: input.repositoryRoot,
      provider: input.provider,
      expectedPath,
      instructions: input.sourceCase.query,
      risk: "low",
      roleId: "canary-researcher",
      verificationSuiteIds: [input.verificationSuiteId],
    });
    const afterStatusDigest = repositoryStatusDigest(input.repositoryRoot);
    assert(
      beforeStatusDigest === afterStatusDigest && outcome.managedChanges.length === 0,
      "lexical_linked_uplift_repository_effect_detected",
    );
    const linkedBytes = await selectedByteCount(input.repositoryRoot, telemetry.linkedSelections);
    return {
      status: "completed",
      provider: input.provider,
      model: input.model,
      arm: input.arm,
      caseId: input.sourceCase.caseId,
      repetition: input.repetition,
      runId: input.runId,
      durationMs: Math.round(performance.now() - started),
      adapterCreations: telemetry.adapterCreations,
      providerStarts: telemetry.providerStarts,
      usage: telemetry.usage,
      potentialLinkedSelectionCount: telemetry.linkedSelections.length,
      appliedLinkedSelectionCount:
        input.arm === "lexical_plus_linked" ? telemetry.linkedSelections.length : 0,
      potentialLinkedSourceBytes: linkedBytes,
      appliedLinkedSourceBytes: input.arm === "lexical_plus_linked" ? linkedBytes : 0,
      estimatedAppliedLinkedTokens:
        input.arm === "lexical_plus_linked" ? Math.ceil(linkedBytes / 4) : 0,
      searchContext: outcome.searchContext,
      score: scoreAnswer(
        telemetry.rawResult,
        input.sourceCase,
        registry,
        outcome.searchContext.referencedDocumentIds,
      ),
      resultArtifact: outcome.resultArtifact,
      rawResultDigest: `sha256:${createHash("sha256").update(telemetry.rawResult).digest("hex")}`,
      verificationStatus: outcome.verificationStatus,
      writingPublicationStatus: outcome.writingPublication.status,
      repositoryStatusDigestBefore: beforeStatusDigest,
      repositoryStatusDigestAfter: afterStatusDigest,
      observedAt: new Date().toISOString(),
    };
  } catch (error) {
    error.upliftEvidence = {
      durationMs: Math.round(performance.now() - started),
      adapterCreations: telemetry.adapterCreations,
      providerStarts: telemetry.providerStarts,
      usage: telemetry.usage,
    };
    throw error;
  }
}
