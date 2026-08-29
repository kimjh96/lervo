import { readdir } from "node:fs/promises";
import { resolve } from "node:path";

import { loadPreparedProviderShadowV2Pilot } from "./linked-evidence-provider-shadow-pilot-v2-preparation.mjs";
import {
  pathExists,
  readOwnerJson,
  writeOwnerJsonAtomic,
} from "./linked-evidence-provider-shadow-pilot-v2-state.mjs";
import { valueDigest } from "./linked-evidence-shadow-phase-a-pilot-contract.mjs";

function percentile(values, percentileValue) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.ceil((percentileValue / 100) * sorted.length) - 1];
}

function ratioBasisPoints(numerator, denominator) {
  return denominator === 0 ? null : Math.round((numerator / denominator) * 10_000);
}

function total(observations, field) {
  return observations.reduce((sum, item) => sum + (item[field] ?? 0), 0);
}

function tokenTotal(observations, field) {
  return observations.reduce((sum, item) => sum + (item.observedTokens?.[field] ?? 0), 0);
}

function evaluateProviderArm(contract, provider, observations, stoppedFailure) {
  const acceptance = contract.acceptance;
  const observed = observations.filter((item) => item.status === "observed");
  const unavailable = observations.filter((item) => item.status === "unavailable");
  const providerInvocationCount = total(observations, "providerInvocationCount");
  const meanPrecisionBasisPoints =
    observed.length === 0
      ? 0
      : Math.round(total(observed, "precisionBasisPoints") / observed.length);
  const durations = observed.map((item) => item.durationMs);
  const providerVisibleSourceBytes = total(observed, "providerVisibleSourceBytes");
  const selectedBodyBytes = total(observed, "selectedBodyBytes");
  const candidateCount = total(observed, "candidateCount");
  const selectedCount = total(observed, "shadowSelectedCount");
  const replayMismatchCount = observations.filter((item) => item.replayMatched !== true).length;
  const privacyFailureCount = observations.filter((item) => item.privacyFailed === true).length;
  const primaryEffectDifferenceCount = observations.filter((item) =>
    [
      item.primaryContextUnchanged,
      item.primaryOutputUnchanged,
      item.managedWritesUnchanged,
      item.verificationUnchanged,
      item.publicationUnchanged,
      item.e1ThroughE4EventsUnchanged,
    ].some((value) => value !== true),
  ).length;
  const stoppedForProvider = stoppedFailure?.provider === provider ? stoppedFailure : null;
  const passed =
    observations.length === acceptance.requiredEligibleObservationsPerProvider &&
    observed.length === acceptance.requiredEligibleObservationsPerProvider &&
    providerInvocationCount === acceptance.requiredProviderInvocationsPerProvider &&
    unavailable.length <= acceptance.maximumUnavailableObservations &&
    replayMismatchCount <= acceptance.maximumReplayMismatches &&
    privacyFailureCount <= acceptance.maximumPrivacyFailures &&
    primaryEffectDifferenceCount <= acceptance.maximumPrimaryEffectDifferences &&
    stoppedForProvider === null &&
    observed.every(
      (item) =>
        item.recallBasisPoints >= acceptance.minimumReviewedExpectedPathRecallBasisPoints &&
        item.precisionBasisPoints >=
          acceptance.minimumPerObservationSelectionPrecisionBasisPoints &&
        item.shadowSelectedCount <= acceptance.maximumSelectedSourcesPerObservation &&
        (item.structuredOutputFramingToolCount ?? 0) <=
          (contract.provider.maximumStructuredOutputFramingToolsPerInvocation ?? 0) &&
        item.failureCode === null &&
        item.terminalStatus === "completed" &&
        typeof item.usageDigest === "string",
    ) &&
    meanPrecisionBasisPoints >= acceptance.minimumMeanSelectionPrecisionBasisPoints &&
    total(observed, "droppedRelevantRecommendationCount") <=
      acceptance.maximumDroppedRelevantRecommendations &&
    total(observed, "droppedRelevantLinkedCount") <=
      acceptance.maximumDroppedRelevantLinkedSources &&
    total(observed, "droppedRelevantCoverageCount") <=
      acceptance.maximumDroppedRelevantCoverageSources;
  return {
    provider,
    passed,
    eligibleObservationCount: observations.length,
    observedCount: observed.length,
    unavailableCount: unavailable.length,
    providerInvocationCount,
    stoppedFailureCode: stoppedForProvider?.failureCode ?? null,
    replayMismatchCount,
    privacyFailureCount,
    primaryEffectDifferenceCount,
    meanPrecisionBasisPoints,
    minimumPrecisionBasisPoints:
      observed.length === 0 ? 0 : Math.min(...observed.map((item) => item.precisionBasisPoints)),
    minimumRecallBasisPoints:
      observed.length === 0 ? 0 : Math.min(...observed.map((item) => item.recallBasisPoints)),
    meanRecallBasisPoints:
      observed.length === 0
        ? 0
        : Math.round(total(observed, "recallBasisPoints") / observed.length),
    candidateCount,
    selectedCount,
    selectedCountRatioBasisPoints: ratioBasisPoints(selectedCount, candidateCount),
    providerVisibleSourceBytes,
    selectedBodyBytes,
    selectedBodyByteRatioBasisPoints: ratioBasisPoints(
      selectedBodyBytes,
      providerVisibleSourceBytes,
    ),
    totalDurationMs: total(observed, "durationMs"),
    meanDurationMs:
      observed.length === 0 ? 0 : Math.round(total(observed, "durationMs") / observed.length),
    medianDurationMs: percentile(durations, 50),
    p95DurationMs: percentile(durations, 95),
    observedTokens: {
      inputTokens: tokenTotal(observed, "inputTokens"),
      cachedInputTokens: tokenTotal(observed, "cachedInputTokens"),
      outputTokens: tokenTotal(observed, "outputTokens"),
      reasoningOutputTokens: tokenTotal(observed, "reasoningOutputTokens"),
      totalTokens: tokenTotal(observed, "totalTokens"),
    },
    droppedRelevantRecommendations: total(observed, "droppedRelevantRecommendationCount"),
    droppedRelevantLinkedSources: total(observed, "droppedRelevantLinkedCount"),
    droppedRelevantCoverageSources: total(observed, "droppedRelevantCoverageCount"),
  };
}

function comparison(codex, claude) {
  return {
    basis: "claude_relative_to_codex",
    precisionBasisPointDifference: claude.meanPrecisionBasisPoints - codex.meanPrecisionBasisPoints,
    recallBasisPointDifference: claude.meanRecallBasisPoints - codex.meanRecallBasisPoints,
    selectedCountDifference: claude.selectedCount - codex.selectedCount,
    selectedBodyByteDifference: claude.selectedBodyBytes - codex.selectedBodyBytes,
    durationDifferenceMs: claude.totalDurationMs - codex.totalDurationMs,
    durationRatioBasisPoints: ratioBasisPoints(claude.totalDurationMs, codex.totalDurationMs),
    totalTokenDifference: claude.observedTokens.totalTokens - codex.observedTokens.totalTokens,
    totalTokenRatioBasisPoints: ratioBasisPoints(
      claude.observedTokens.totalTokens,
      codex.observedTokens.totalTokens,
    ),
  };
}

export async function reviewProviderShadowV2Pilot(repositoryRoot, contractPath) {
  const prepared = await loadPreparedProviderShadowV2Pilot(repositoryRoot, contractPath);
  const files = (await readdir(prepared.paths.observations)).sort();
  const observations = await Promise.all(
    files.map((path) => readOwnerJson(resolve(prepared.paths.observations, path))),
  );
  const stoppedFailure = (await pathExists(prepared.paths.failure))
    ? await readOwnerJson(prepared.paths.failure)
    : null;
  const runByOrdinal = new Map(
    prepared.manifest.schedule.map((item) => [item.shadowOrdinal, item]),
  );
  const forbiddenValues = [
    ...new Set([
      prepared.phase.repository,
      ...prepared.manifest.schedule.flatMap((item) => [item.query, item.targetPath]),
      ...prepared.reconstructed.corpus.flatMap((source) => [source.path, source.text]),
    ]),
  ];
  for (const observation of observations) {
    const runSpec = runByOrdinal.get(observation.shadowOrdinal);
    const serialized = JSON.stringify(observation);
    observation.privacyFailed = forbiddenValues.some((value) => serialized.includes(value));
    observation.replayMatched =
      runSpec !== undefined &&
      observation.candidateEnvelopeDigest === runSpec.candidateEnvelopeDigest &&
      valueDigest(observation.candidates) === valueDigest(runSpec.candidates);
  }
  const byProvider = Object.fromEntries(
    prepared.loaded.contract.provider.arms.map((arm) => [
      arm.provider,
      evaluateProviderArm(
        prepared.loaded.contract,
        arm.provider,
        observations.filter((item) => item.provider === arm.provider),
        stoppedFailure,
      ),
    ]),
  );
  const pairedSourceSampleCount = new Set(observations.map((item) => item.sourceSampleId)).size;
  const everyPairComplete = [...new Set(observations.map((item) => item.sourceSampleId))].every(
    (sourceSampleId) =>
      prepared.loaded.contract.provider.arms.every(
        (arm) =>
          observations.filter(
            (item) => item.sourceSampleId === sourceSampleId && item.provider === arm.provider,
          ).length === 1,
      ),
  );
  const passed =
    observations.length === prepared.loaded.contract.acceptance.requiredEligibleObservations &&
    pairedSourceSampleCount ===
      prepared.loaded.contract.sourcePopulation.expectedShadowSampleCount &&
    everyPairComplete &&
    Object.values(byProvider).every((item) => item.passed);
  const byCase = [...new Set(observations.map((item) => item.caseId))].map((caseId) => ({
    caseId,
    providers: Object.fromEntries(
      prepared.loaded.contract.provider.arms.map((arm) => {
        const items = observations.filter(
          (item) => item.caseId === caseId && item.provider === arm.provider,
        );
        return [
          arm.provider,
          {
            observationCount: items.length,
            meanPrecisionBasisPoints:
              items.length === 0
                ? 0
                : Math.round(total(items, "precisionBasisPoints") / items.length),
            minimumRecallBasisPoints:
              items.length === 0 ? 0 : Math.min(...items.map((item) => item.recallBasisPoints)),
            selectedCount: total(items, "shadowSelectedCount"),
            unexpectedSelectionCount: total(items, "unexpectedSelectionCount"),
          },
        ];
      }),
    ),
  }));
  const review = {
    schemaVersion: 2,
    pilotId: prepared.manifest.pilotId,
    preparedManifestDigest: prepared.manifestDigest,
    reviewedAt: new Date().toISOString(),
    status: passed ? "passed" : "failed",
    passed,
    observationCount: observations.length,
    pairedSourceSampleCount,
    everyPairComplete,
    byProvider,
    comparison:
      byProvider.codex === undefined || byProvider.claude === undefined
        ? null
        : comparison(byProvider.codex, byProvider.claude),
    byCase,
  };
  await writeOwnerJsonAtomic(prepared.paths.review, review);
  if (!passed) throw new Error("The paired provider-shadow v2 pilot failed its exact review gate.");
  return review;
}
