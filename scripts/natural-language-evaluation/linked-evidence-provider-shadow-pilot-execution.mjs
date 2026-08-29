import { randomUUID } from "node:crypto";
import { access, chmod, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  observePrimaryBaseline,
  loadPreparedProviderShadowPilot,
  ownerJson,
} from "./linked-evidence-provider-shadow-pilot-preparation.mjs";
import { runProviderShadowTurn } from "./linked-evidence-provider-shadow-pilot-turn.mjs";

function observationId() {
  return `pshadow_${randomUUID().replaceAll("-", "")}`;
}

function usageCounts(usage) {
  return {
    inputTokens: usage.inputTokens ?? 0,
    cachedInputTokens: usage.cachedInputTokens ?? 0,
    outputTokens: usage.outputTokens ?? 0,
    reasoningOutputTokens: usage.reasoningOutputTokens ?? 0,
    totalTokens: usage.totalTokens ?? 0,
    contextWindow: usage.contextWindow ?? 0,
  };
}

function selectionMetrics(runSpec, selected) {
  const expected = new Set(runSpec.expectedDocumentIds);
  const selectedIds = new Set(selected.map((item) => item.documentId));
  const relevantSelectedCount = [...selectedIds].filter((item) => expected.has(item)).length;
  const unexpectedSelectionCount = [...selectedIds].filter((item) => !expected.has(item)).length;
  const droppedByClass = { recommendation: 0, linked: 0, coverage: 0 };
  for (const candidate of runSpec.candidates) {
    if (!expected.has(candidate.documentId) || selectedIds.has(candidate.documentId)) continue;
    for (const className of candidate.classes) droppedByClass[className] += 1;
  }
  return {
    relevantSelectedCount,
    unexpectedSelectionCount,
    recallBasisPoints: Math.round((relevantSelectedCount / expected.size) * 10_000),
    precisionBasisPoints:
      selectedIds.size === 0 ? 0 : Math.round((relevantSelectedCount / selectedIds.size) * 10_000),
    droppedRelevantRecommendationCount: droppedByClass.recommendation,
    droppedRelevantLinkedCount: droppedByClass.linked,
    droppedRelevantCoverageCount: droppedByClass.coverage,
  };
}

async function writeObservation(path, observation) {
  await mkdir(resolve(path, ".."), { recursive: true, mode: 0o700 });
  await writeFile(path, `${JSON.stringify(observation, null, 2)}\n`, {
    flag: "wx",
    mode: 0o600,
  });
  await chmod(path, 0o600);
}

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export async function executeProviderShadowPilot(
  repositoryRoot,
  contractPath,
  createAdapter,
  onProgress = () => undefined,
) {
  const prepared = await loadPreparedProviderShadowPilot(repositoryRoot, contractPath);
  await mkdir(prepared.paths.observations, { recursive: true, mode: 0o700 });
  if (
    (await readdir(prepared.paths.observations)).length !== 0 ||
    (await exists(prepared.paths.execution)) ||
    (await exists(prepared.paths.failure))
  ) {
    throw new Error(
      "Existing provider-shadow execution state was preserved; execution cannot resume.",
    );
  }
  const sourceById = new Map(
    prepared.reconstructed.corpus.map((source) => [source.sourceId, source]),
  );
  let providerInvocationCount = 0;
  for (const runSpec of prepared.manifest.schedule) {
    onProgress({
      phase: "shadow_started",
      shadowOrdinal: runSpec.shadowOrdinal,
      caseId: runSpec.caseId,
    });
    const candidateSources = runSpec.candidates.map((candidate) => {
      const source = sourceById.get(candidate.documentId);
      if (source === undefined || source.contentHash !== candidate.contentHash) {
        throw new Error("provider_shadow_candidate_drift");
      }
      return source;
    });
    try {
      const result = await runProviderShadowTurn({
        createAdapter,
        repositoryRoot: prepared.phase.repository,
        projectId: prepared.manifest.projectId,
        model: prepared.loaded.contract.provider.model,
        query: runSpec.query,
        candidateSources,
        timeoutMs: prepared.loaded.contract.provider.timeoutMsPerInvocation,
        maximumResultBytes: prepared.loaded.contract.provider.maximumResultBytes,
        maximumSelectedSources: prepared.loaded.contract.selectionProtocol.maximumSelectedSources,
      });
      providerInvocationCount += result.providerInvocationCount;
      const after = await observePrimaryBaseline(prepared.phase.repository, runSpec);
      const effects = {
        primaryContextUnchanged:
          after.contextEventDigest === runSpec.primaryBaseline.contextEventDigest,
        primaryOutputUnchanged: after.outputDigest === runSpec.primaryBaseline.outputDigest,
        managedWritesUnchanged:
          after.repositoryStatusDigest === runSpec.primaryBaseline.repositoryStatusDigest,
        verificationUnchanged:
          after.verificationDigest === runSpec.primaryBaseline.verificationDigest,
        publicationUnchanged: after.publicationDigest === runSpec.primaryBaseline.publicationDigest,
        e1ThroughE4EventsUnchanged:
          after.contextEventDigest === runSpec.primaryBaseline.contextEventDigest,
      };
      if (Object.values(effects).some((value) => !value)) {
        throw new Error("provider_shadow_primary_effect_detected");
      }
      const metrics = selectionMetrics(runSpec, result.selected);
      const observation = {
        schemaVersion: 1,
        recordKind: prepared.loaded.contract.observation.recordKind,
        recordId: observationId(),
        status: "observed",
        pilotId: prepared.manifest.pilotId,
        projectId: prepared.manifest.projectId,
        sourceRunId: runSpec.sourceRunId,
        shadowRunId: result.shadowRunId,
        sessionId: result.sessionId,
        providerSessionId: result.providerSessionId,
        adapterId: result.adapterId,
        provider: prepared.loaded.contract.provider.provider,
        model: prepared.loaded.contract.provider.model,
        targetTurnId: result.targetTurnId,
        providerTurnId: result.providerTurnId,
        adapterReceiptId: result.adapterReceiptId,
        sourceManifestDigest: prepared.manifest.sourcePhaseAManifestDigest,
        sourceSnapshotDigest: prepared.manifest.sourceSnapshotDigest,
        suiteDigest: prepared.manifest.sourceSuiteDigest,
        selectionProtocolDigest: prepared.loaded.contract.selectionProtocol.protocolDigest,
        candidateEnvelopeDigest: runSpec.candidateEnvelopeDigest,
        requestDigest: result.requestDigest,
        resultDigest: result.resultDigest,
        usageDigest: result.usageDigest,
        shadowOrdinal: runSpec.shadowOrdinal,
        sourceOrdinal: runSpec.sourceOrdinal,
        caseId: runSpec.caseId,
        repetition: runSpec.repetition,
        lexicalCount: runSpec.recommendationCount,
        linkedCount: runSpec.linkedCount,
        coverageCount: runSpec.coverageCount,
        candidateCount: runSpec.candidateCount,
        shadowSelectedCount: result.selected.length,
        reviewedRelevantCount: runSpec.expectedDocumentIds.length,
        ...metrics,
        candidates: runSpec.candidates.map(({ documentId, contentHash }) => ({
          documentId,
          contentHash,
        })),
        shadowSelected: result.selected,
        providerVisibleSourceBytes: runSpec.providerVisibleSourceBytes,
        resultBytes: result.resultBytes,
        durationMs: result.durationMs,
        observedTokens: usageCounts(result.usage),
        terminalStatus: result.terminalStatus,
        failureCode: null,
        ...effects,
        providerInvocationCount: result.providerInvocationCount,
      };
      await writeObservation(
        resolve(
          prepared.paths.observations,
          `${String(runSpec.shadowOrdinal).padStart(2, "0")}.json`,
        ),
        observation,
      );
      await ownerJson(prepared.paths.execution, {
        schemaVersion: 1,
        pilotId: prepared.manifest.pilotId,
        preparedManifestDigest: prepared.manifestDigest,
        completedObservationCount: runSpec.shadowOrdinal,
        providerInvocationCount,
        status:
          runSpec.shadowOrdinal === prepared.manifest.schedule.length ? "completed" : "running",
      });
      onProgress({
        phase: "shadow_completed",
        shadowOrdinal: runSpec.shadowOrdinal,
        selectedCount: result.selected.length,
        recallBasisPoints: metrics.recallBasisPoints,
        precisionBasisPoints: metrics.precisionBasisPoints,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "";
      providerInvocationCount +=
        error !== null && typeof error === "object" ? (error.providerInvocationCount ?? 0) : 0;
      const code = prepared.loaded.contract.stopConditions.includes(errorMessage)
        ? errorMessage
        : "provider_shadow_adapter_failed";
      await ownerJson(prepared.paths.failure, {
        schemaVersion: 1,
        pilotId: prepared.manifest.pilotId,
        preparedManifestDigest: prepared.manifestDigest,
        status: "stopped",
        shadowOrdinal: runSpec.shadowOrdinal,
        caseId: runSpec.caseId,
        failureCode: code,
        providerInvocationCount,
      });
      throw new Error(`Provider-shadow execution stopped at ${runSpec.shadowOrdinal}: ${code}.`, {
        cause: error,
      });
    }
  }
  return JSON.parse(await readFile(prepared.paths.execution, "utf8"));
}
