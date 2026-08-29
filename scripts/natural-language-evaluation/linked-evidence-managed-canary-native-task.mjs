import { createHash } from "node:crypto";

import { repositoryStatusDigest } from "./linked-evidence-provider-shadow-pilot-preparation.mjs";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

export function extractManagedCanaryV5References(content, currentVersions) {
  const references = new Map();
  const pattern = /lervo-e4:(doc_[a-z0-9_]+):(sha256:[a-f0-9]{64})/gu;
  for (const match of content.matchAll(pattern)) {
    const [, documentId, contentHash] = match;
    if (currentVersions.get(documentId) === contentHash) {
      references.set(documentId, { documentId, contentHash });
    }
  }
  return [...references.values()].sort((left, right) =>
    left.documentId.localeCompare(right.documentId),
  );
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

function deterministicAuthorization(checkpointId, run) {
  return {
    schemaVersion: 1,
    enabled: true,
    policyId: "linked-evidence-managed-canary-v1",
    canaryId: checkpointId,
    projectId: run.projectId,
    runId: run.runId,
    provider: run.provider,
    sourceSnapshotId: run.sourceSnapshotId,
    recommendationBatchId: run.recommendationBatchId,
    selectionAttemptId: run.selectionAttemptId,
    managedContextEffectsAuthorized: true,
    maximumProviderCalls: 0,
    deterministicSelection: {
      kind: run.selectionEvidence.kind,
      policyId: run.selectionEvidence.policyId,
      policyDigest: run.selectionEvidence.policyDigest,
      sourceProjectionDigest: run.selectionEvidence.sourceProjectionDigest,
      projectedSelectionDigest: run.selectionEvidence.projectedSelectionDigest,
      projectedSelectionCount: run.selectionEvidence.projectedSelectionCount,
    },
  };
}

export async function executeManagedCanaryNativeTask(input) {
  const [
    { createManagedRunExecutor },
    { CodexAdapter },
    { ClaudeAdapter },
    project,
    storage,
    searchLocal,
  ] = await Promise.all([
    import("../../apps/cli/dist/managed-run.js"),
    import("../../packages/adapter-codex/dist/index.js"),
    import("../../packages/adapter-claude/dist/index.js"),
    import("../../packages/project/dist/index.js"),
    import("../../packages/project-storage/dist/index.js"),
    import("../../packages/search-local/dist/index.js"),
  ]);
  const registry = await project.loadDocumentRegistry(input.sourceRepository);
  const expectedPath = registry.documents[input.run.expectedDocumentIds[0]]?.path;
  assert(expectedPath !== undefined, "managed_canary_v5_expected_path_missing");
  const corpus = await searchLocal.loadRegisteredDocumentCorpus(input.sourceRepository);
  const currentVersions = new Map(
    corpus.map((document) => [document.sourceId, document.contentHash]),
  );
  const telemetry = { usage: null, rawResult: "", adapterCreations: 0, providerStarts: 0 };
  const beforeStatusDigest = repositoryStatusDigest(input.sourceRepository);
  const started = performance.now();
  try {
    const execute = createManagedRunExecutor({
      openStorage: storage.openProjectStorage,
      createId: idFactory(input.run.runId),
      now: () => new Date(input.run.observedAt),
      createSearchNonce: () => input.run.searchNonce,
      createAdapter: (adapterInput) => {
        telemetry.adapterCreations += 1;
        assert(
          adapterInput.selectionBoundary === undefined,
          "managed_canary_v5_selection_adapter_created",
        );
        const adapter =
          adapterInput.provider === "codex"
            ? new CodexAdapter({
                repositoryRoot: adapterInput.repositoryRoot,
                resolveArtifact: adapterInput.resolveArtifact,
                model: "gpt-5.6-sol",
                sandbox: "read-only",
                approvalPolicy: "never",
              })
            : new ClaudeAdapter({
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
    const outcome = await execute({
      repositoryRoot: input.sourceRepository,
      provider: input.run.provider,
      expectedPath,
      instructions: input.sourceItem.query,
      risk: "low",
      roleId: input.roleId,
      verificationSuiteIds: [input.sourceItem.verificationSuiteId],
      linkedEvidenceCanaryAuthorization: deterministicAuthorization(input.checkpointId, input.run),
    });
    const references = outcome.searchContext.referencedDocumentIds
      .map((documentId) => ({ documentId, contentHash: currentVersions.get(documentId) }))
      .sort((left, right) => left.documentId.localeCompare(right.documentId));
    assert(
      references.every((item) => item.contentHash !== undefined),
      "managed_canary_v5_reference_version_mismatch",
    );
    const expected = input.run.expectedDocumentIds.map((documentId) => ({
      documentId,
      contentHash: currentVersions.get(documentId),
    }));
    assert(
      expected.every((item) => item.contentHash !== undefined),
      "managed_canary_v5_expected_version_missing",
    );
    const expectedIds = new Set(input.run.expectedDocumentIds);
    const expectedReferencedCount = references.filter((item) =>
      expectedIds.has(item.documentId),
    ).length;
    const repositoryStatusDigestAfter = repositoryStatusDigest(input.sourceRepository);
    assert(
      beforeStatusDigest === repositoryStatusDigestAfter && outcome.managedChanges.length === 0,
      "managed_canary_v5_repository_effect_detected",
    );
    return {
      adapterCreations: telemetry.adapterCreations,
      providerStarts: telemetry.providerStarts,
      durationMs: Math.round(performance.now() - started),
      usage: telemetry.usage,
      expected,
      references,
      expectedReferencedCount,
      sourceRecall: expectedReferencedCount / expected.length,
      referencePrecision: references.length === 0 ? 0 : expectedReferencedCount / references.length,
      verificationStatus: outcome.verificationStatus,
      writingPublicationStatus: outcome.writingPublication.status,
      repositoryStatusDigestBefore: beforeStatusDigest,
      repositoryStatusDigestAfter,
      resultArtifactDigest: outcome.resultArtifact.contentHash,
    };
  } catch (error) {
    if (error instanceof Error) {
      error.canaryEvidence = {
        adapterCreations: telemetry.adapterCreations,
        providerStarts: telemetry.providerStarts,
        durationMs: Math.round(performance.now() - started),
        usage: telemetry.usage,
      };
    }
    throw error;
  }
}
