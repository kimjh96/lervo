import { randomUUID } from "node:crypto";

import { buildProviderShadowV2UnavailableObservation } from "./linked-evidence-provider-shadow-pilot-v2-contract.mjs";
import { validateProviderShadowSelectionViolationCodes } from "./linked-evidence-provider-shadow-pilot-v2-policy.mjs";

function observationId(prepared) {
  const prefix = prepared.loaded.contract.sourcePopulation.coordinatePrefix ?? "psv2";
  return `${prefix}obs_${randomUUID().replaceAll("-", "")}`;
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
  const selectedBodyBytes = runSpec.candidates
    .filter((candidate) => selectedIds.has(candidate.documentId))
    .reduce((total, candidate) => total + candidate.byteCount, 0);
  return {
    relevantSelectedCount,
    unexpectedSelectionCount,
    recallBasisPoints: Math.round((relevantSelectedCount / expected.size) * 10_000),
    precisionBasisPoints:
      selectedIds.size === 0 ? 0 : Math.round((relevantSelectedCount / selectedIds.size) * 10_000),
    droppedRelevantRecommendationCount: droppedByClass.recommendation,
    droppedRelevantLinkedCount: droppedByClass.linked,
    droppedRelevantCoverageCount: droppedByClass.coverage,
    selectedBodyBytes,
  };
}

export function observeProviderShadowV2PrimaryEffects(before, after) {
  return {
    primaryContextUnchanged: after.contextEventDigest === before.contextEventDigest,
    primaryOutputUnchanged: after.outputDigest === before.outputDigest,
    managedWritesUnchanged: after.repositoryStatusDigest === before.repositoryStatusDigest,
    verificationUnchanged: after.verificationDigest === before.verificationDigest,
    publicationUnchanged: after.publicationDigest === before.publicationDigest,
    e1ThroughE4EventsUnchanged: after.contextEventDigest === before.contextEventDigest,
  };
}

function missingCoordinates(outcome) {
  return ["providerSessionId", "adapterReceiptId", "providerTurnId"].filter(
    (field) => outcome[field] === null,
  );
}

function commonObservation(prepared, runSpec, outcome, effects) {
  return {
    schemaVersion: 2,
    pilotId: prepared.manifest.pilotId,
    projectId: prepared.manifest.projectId,
    sourceSampleId: runSpec.sourceSampleId,
    sampleId: runSpec.sampleId,
    sourceRunId: runSpec.sourceRunId,
    shadowRunId: outcome.shadowRunId,
    sessionId: outcome.sessionId,
    providerSessionId: outcome.providerSessionId,
    adapterId: outcome.adapterId,
    provider: runSpec.provider,
    model: runSpec.model,
    targetTurnId: outcome.targetTurnId,
    providerTurnId: outcome.providerTurnId,
    adapterReceiptId: outcome.adapterReceiptId,
    sourceManifestDigest: prepared.manifest.sourcePhaseAManifestDigest,
    sourceSnapshotDigest: prepared.manifest.sourceSnapshotDigest,
    suiteDigest: prepared.manifest.sourceSuiteDigest,
    selectionProtocolDigest: prepared.loaded.contract.selectionProtocol.protocolDigest,
    candidateEnvelopeDigest: runSpec.candidateEnvelopeDigest,
    requestDigest: outcome.requestDigest,
    shadowOrdinal: runSpec.shadowOrdinal,
    sourceShadowOrdinal: runSpec.sourceShadowOrdinal,
    sourceOrdinal: runSpec.sourceOrdinal,
    caseId: runSpec.caseId,
    repetition: runSpec.repetition,
    lexicalCount: runSpec.recommendationCount,
    linkedCount: runSpec.linkedCount,
    coverageCount: runSpec.coverageCount,
    candidateCount: runSpec.candidateCount,
    reviewedRelevantCount: runSpec.expectedDocumentIds.length,
    candidates: runSpec.candidates.map(({ documentId, contentHash, byteCount, classes }) => ({
      documentId,
      contentHash,
      byteCount,
      classes,
    })),
    providerVisibleSourceBytes: runSpec.providerVisibleSourceBytes,
    providerInvocationCount: outcome.providerInvocationCount,
    ...effects,
  };
}

export function buildProviderShadowV2ObservedRecord(prepared, runSpec, outcome, effects) {
  const metrics = selectionMetrics(runSpec, outcome.selected);
  return {
    recordKind: prepared.loaded.contract.observation.recordKind,
    recordId: observationId(prepared),
    status: "observed",
    ...commonObservation(prepared, runSpec, outcome, effects),
    shadowSelectedCount: outcome.selected.length,
    ...metrics,
    shadowSelected: outcome.selected,
    resultDigest: outcome.resultDigest,
    resultBytes: outcome.resultBytes,
    durationMs: outcome.durationMs,
    observedTokens: usageCounts(outcome.usage),
    usageDigest: outcome.usageDigest,
    terminalStatus: outcome.terminalStatus,
    structuredOutputFramingToolCount: outcome.structuredOutputFramingToolCount,
    failureCode: null,
    lastDurableAttemptDigest: outcome.lastDurableAttemptDigest,
  };
}

export function buildProviderShadowV2UnavailableRecord(prepared, runSpec, outcome, effects) {
  const unavailable = buildProviderShadowV2UnavailableObservation({
    observationId: observationId(prepared),
    sampleId: runSpec.sampleId,
    availabilityStage: outcome.availabilityStage,
    missingCoordinates: missingCoordinates(outcome),
    failureCode: "provider_shadow_observation_unavailable",
    lastDurableAttemptDigest: outcome.lastDurableAttemptDigest,
    providerInvocationCount: outcome.providerInvocationCount,
    providerSessionId: outcome.providerSessionId,
    adapterReceiptId: outcome.adapterReceiptId,
    providerTurnId: outcome.providerTurnId,
    recordKind: prepared.loaded.contract.observation.recordKind,
  }).record;
  return {
    ...unavailable,
    recordId: unavailable.observationId,
    ...commonObservation(prepared, runSpec, outcome, effects),
    providerFailureCode: outcome.failureCode,
    selectionViolationCodes: validateProviderShadowSelectionViolationCodes(
      outcome.selectionViolationCodes ?? [],
    ),
    terminalStatus: "unavailable",
  };
}
