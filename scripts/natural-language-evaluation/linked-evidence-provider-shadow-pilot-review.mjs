import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { valueDigest } from "./linked-evidence-provider-shadow-pilot-contract.mjs";
import {
  loadPreparedProviderShadowPilot,
  ownerJson,
} from "./linked-evidence-provider-shadow-pilot-preparation.mjs";

export function evaluateProviderShadowReview(contract, observations, stoppedFailure = null) {
  const unavailable = observations.filter((item) => item.status === "unavailable");
  const providerInvocationCount = observations.reduce(
    (total, item) => total + item.providerInvocationCount,
    stoppedFailure?.providerInvocationCount ?? 0,
  );
  const adapterFailureCount =
    stoppedFailure?.failureCode === "provider_shadow_adapter_failed" ? 1 : 0;
  const invalidResultCount =
    stoppedFailure?.failureCode === "provider_shadow_result_invalid" ? 1 : 0;
  const missingUsageCount =
    stoppedFailure?.failureCode === "provider_shadow_usage_unavailable" ? 1 : 0;
  const privacyFailures = observations.filter((item) => item.privacyFailed === true);
  const replayMismatches = observations.filter((item) => item.replayMatched === false);
  const primaryEffectDifferences = observations.filter((item) =>
    [
      item.primaryContextUnchanged,
      item.primaryOutputUnchanged,
      item.managedWritesUnchanged,
      item.verificationUnchanged,
      item.publicationUnchanged,
      item.e1ThroughE4EventsUnchanged,
    ].some((value) => value !== true),
  );
  const meanPrecisionBasisPoints =
    observations.length === 0
      ? 0
      : Math.round(
          observations.reduce((total, item) => total + item.precisionBasisPoints, 0) /
            observations.length,
        );
  const totalTokens = observations.reduce(
    (total, item) => total + item.observedTokens.totalTokens,
    0,
  );
  const totalDurationMs = observations.reduce((total, item) => total + item.durationMs, 0);
  const droppedRelevantRecommendations = observations.reduce(
    (total, item) => total + item.droppedRelevantRecommendationCount,
    0,
  );
  const droppedRelevantLinkedSources = observations.reduce(
    (total, item) => total + item.droppedRelevantLinkedCount,
    0,
  );
  const droppedRelevantCoverageSources = observations.reduce(
    (total, item) => total + item.droppedRelevantCoverageCount,
    0,
  );
  const acceptance = contract.acceptance;
  const passed =
    observations.length === acceptance.requiredEligibleObservations &&
    providerInvocationCount === acceptance.requiredProviderInvocations &&
    unavailable.length <= acceptance.maximumUnavailableObservations &&
    adapterFailureCount <= acceptance.maximumAdapterFailures &&
    invalidResultCount <= acceptance.maximumInvalidResults &&
    missingUsageCount <= acceptance.maximumMissingUsageObservations &&
    replayMismatches.length <= acceptance.maximumReplayMismatches &&
    privacyFailures.length <= acceptance.maximumPrivacyFailures &&
    primaryEffectDifferences.length <= acceptance.maximumPrimaryEffectDifferences &&
    observations.every(
      (item) =>
        item.recallBasisPoints >= acceptance.minimumReviewedExpectedPathRecallBasisPoints &&
        item.precisionBasisPoints >=
          acceptance.minimumPerObservationSelectionPrecisionBasisPoints &&
        item.shadowSelectedCount <= acceptance.maximumSelectedSourcesPerObservation &&
        item.failureCode === null &&
        item.terminalStatus === "completed" &&
        typeof item.usageDigest === "string",
    ) &&
    meanPrecisionBasisPoints >= acceptance.minimumMeanSelectionPrecisionBasisPoints &&
    droppedRelevantRecommendations <= acceptance.maximumDroppedRelevantRecommendations &&
    droppedRelevantLinkedSources <= acceptance.maximumDroppedRelevantLinkedSources &&
    droppedRelevantCoverageSources <= acceptance.maximumDroppedRelevantCoverageSources;
  return {
    passed,
    eligibleObservationCount: observations.length,
    providerInvocationCount,
    unavailableCount: unavailable.length,
    adapterFailureCount,
    invalidResultCount,
    missingUsageCount,
    stoppedFailureCode: stoppedFailure?.failureCode ?? null,
    replayMismatchCount: replayMismatches.length,
    privacyFailureCount: privacyFailures.length,
    primaryEffectDifferenceCount: primaryEffectDifferences.length,
    meanPrecisionBasisPoints,
    minimumPrecisionBasisPoints:
      observations.length === 0
        ? 0
        : Math.min(...observations.map((item) => item.precisionBasisPoints)),
    minimumRecallBasisPoints:
      observations.length === 0
        ? 0
        : Math.min(...observations.map((item) => item.recallBasisPoints)),
    droppedRelevantRecommendations,
    droppedRelevantLinkedSources,
    droppedRelevantCoverageSources,
    totalTokens,
    totalDurationMs,
  };
}

export async function reviewProviderShadowPilot(repositoryRoot, contractPath) {
  const prepared = await loadPreparedProviderShadowPilot(repositoryRoot, contractPath);
  const files = (await readdir(prepared.paths.observations)).sort();
  const observations = await Promise.all(
    files.map(async (path) =>
      JSON.parse(await readFile(resolve(prepared.paths.observations, path), "utf8")),
    ),
  );
  let stoppedFailure = null;
  try {
    stoppedFailure = JSON.parse(await readFile(prepared.paths.failure, "utf8"));
  } catch (error) {
    if (error === null || typeof error !== "object" || error.code !== "ENOENT") throw error;
  }
  const runByOrdinal = new Map(
    prepared.manifest.schedule.map((item) => [item.shadowOrdinal, item]),
  );
  const forbiddenValues = [
    ...new Set([
      prepared.phase.repository,
      ...prepared.manifest.schedule.flatMap((item) => [item.query, item.targetPath]),
      ...prepared.reconstructed.corpus.map((source) => source.path),
    ]),
  ];
  for (const observation of observations) {
    const runSpec = runByOrdinal.get(observation.shadowOrdinal);
    const serialized = JSON.stringify(observation);
    observation.privacyFailed = forbiddenValues.some((value) => serialized.includes(value));
    observation.replayMatched =
      runSpec !== undefined &&
      observation.candidateEnvelopeDigest === runSpec.candidateEnvelopeDigest &&
      valueDigest(observation.candidates) ===
        valueDigest(
          runSpec.candidates.map(({ documentId, contentHash }) => ({
            documentId,
            contentHash,
          })),
        );
  }
  const assessment = evaluateProviderShadowReview(
    prepared.loaded.contract,
    observations,
    stoppedFailure,
  );
  const byCase = [...new Set(observations.map((item) => item.caseId))].map((caseId) => {
    const items = observations.filter((item) => item.caseId === caseId);
    return {
      caseId,
      observationCount: items.length,
      meanPrecisionBasisPoints: Math.round(
        items.reduce((total, item) => total + item.precisionBasisPoints, 0) / items.length,
      ),
      minimumRecallBasisPoints: Math.min(...items.map((item) => item.recallBasisPoints)),
      selectedCount: items.reduce((total, item) => total + item.shadowSelectedCount, 0),
      unexpectedSelectionCount: items.reduce(
        (total, item) => total + item.unexpectedSelectionCount,
        0,
      ),
    };
  });
  const review = {
    schemaVersion: 1,
    pilotId: prepared.manifest.pilotId,
    preparedManifestDigest: prepared.manifestDigest,
    reviewedAt: new Date().toISOString(),
    status: assessment.passed ? "passed" : "failed",
    ...assessment,
    byCase,
  };
  await ownerJson(prepared.paths.review, review);
  if (!assessment.passed) {
    throw new Error("The provider-shadow pilot failed a pre-registered review gate.");
  }
  return review;
}
