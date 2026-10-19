import {
  ManagedLinkedEvidenceCanaryError,
  managedLinkedEvidenceDeterministicSelectionPolicy,
  managedLinkedEvidenceCanaryPolicy,
  projectManagedLinkedEvidenceCanary,
  type LinkedEvidenceShadowSource,
} from "@lervo/context";
import {
  assertSearchRecommendationBatch,
  sameSearchEngine,
  SEARCH_ENGINE,
  type SearchRecommendationBatch,
} from "@lervo/search";
import { loadRegisteredDocumentCorpus } from "@lervo/search-local";

import type {
  ManagedLinkedEvidenceCanaryAuthorization,
  ManagedLinkedEvidenceProvider,
} from "./managed-linked-evidence-canary-contract.js";

function asCorpusSource(source: Awaited<ReturnType<typeof loadRegisteredDocumentCorpus>>[number]) {
  if (source.kind !== "document" || source.path === undefined) {
    throw new ManagedLinkedEvidenceCanaryError(
      "canary_source_changed",
      "A registered managed canary source has no document path.",
    );
  }
  return {
    documentId: source.sourceId,
    path: source.path,
    contentHash: source.contentHash,
    text: source.text,
  } satisfies LinkedEvidenceShadowSource;
}

export async function prepareManagedLinkedEvidenceProjection(input: {
  repositoryRoot: string;
  operationalBatch: SearchRecommendationBatch;
  recommendationBatches: readonly SearchRecommendationBatch[];
}) {
  assertSearchRecommendationBatch(input.operationalBatch);
  for (const batch of input.recommendationBatches) assertSearchRecommendationBatch(batch);
  if (!sameSearchEngine(input.operationalBatch.attempt.engine, SEARCH_ENGINE)) {
    throw new ManagedLinkedEvidenceCanaryError(
      "canary_not_eligible",
      "The managed run does not use the eligible lexical engine.",
    );
  }
  const corpus = (await loadRegisteredDocumentCorpus(input.repositoryRoot)).map(asCorpusSource);
  const corpusByDocumentId = new Map(corpus.map((source) => [source.documentId, source]));
  const selectedIds = new Set(input.operationalBatch.selectedRecommendationIds);
  const recommendations = input.operationalBatch.recommendations
    .filter((item) => selectedIds.has(item.recommendationId))
    .map((item) => {
      const source = corpusByDocumentId.get(item.documentId);
      if (source === undefined || source.contentHash !== item.sourceContentHash) {
        throw new ManagedLinkedEvidenceCanaryError(
          "canary_source_changed",
          "A managed recommendation differs from the current registered corpus.",
        );
      }
      return source;
    });
  const existingDocumentIds = new Set([
    ...input.recommendationBatches.flatMap((batch) =>
      batch.recommendations.map((item) => item.documentId),
    ),
  ]);
  return projectManagedLinkedEvidenceCanary({
    corpus,
    recommendations,
    existingPaths: corpus
      .filter((source) => existingDocumentIds.has(source.documentId))
      .map((source) => source.path),
  });
}

export function assertManagedLinkedEvidenceAuthorization(input: {
  authorization: ManagedLinkedEvidenceCanaryAuthorization;
  projectId: string;
  runId: string;
  provider: ManagedLinkedEvidenceProvider;
  recommendationBatchId: string;
  sourceSnapshotId?: string;
}): void {
  const value = input.authorization;
  const selectionAuthorityValid =
    value.maximumProviderCalls === 1
      ? !("deterministicSelection" in value)
      : value.maximumProviderCalls === 0 &&
        "deterministicSelection" in value &&
        value.deterministicSelection.kind ===
          managedLinkedEvidenceDeterministicSelectionPolicy.kind &&
        value.deterministicSelection.policyId ===
          managedLinkedEvidenceDeterministicSelectionPolicy.policyId &&
        value.deterministicSelection.policyDigest ===
          managedLinkedEvidenceDeterministicSelectionPolicy.digest &&
        /^sha256:[a-f0-9]{64}$/u.test(value.deterministicSelection.sourceProjectionDigest) &&
        /^sha256:[a-f0-9]{64}$/u.test(value.deterministicSelection.projectedSelectionDigest) &&
        Number.isSafeInteger(value.deterministicSelection.projectedSelectionCount) &&
        value.deterministicSelection.projectedSelectionCount >= 1 &&
        value.deterministicSelection.projectedSelectionCount <=
          managedLinkedEvidenceCanaryPolicy.maximumCandidates;
  if (
    value.schemaVersion !== 1 ||
    value.enabled !== true ||
    value.policyId !== managedLinkedEvidenceCanaryPolicy.id ||
    value.projectId !== input.projectId ||
    value.runId !== input.runId ||
    value.provider !== input.provider ||
    value.recommendationBatchId !== input.recommendationBatchId ||
    !selectionAuthorityValid ||
    value.managedContextEffectsAuthorized !== true ||
    !/^[a-z][a-z0-9_-]{7,63}$/u.test(value.canaryId) ||
    !/^lsel_[a-f0-9]{24}$/u.test(value.selectionAttemptId) ||
    !/^sha256:[a-f0-9]{64}$/u.test(value.sourceSnapshotId) ||
    (input.sourceSnapshotId !== undefined && value.sourceSnapshotId !== input.sourceSnapshotId)
  ) {
    throw new ManagedLinkedEvidenceCanaryError(
      "canary_not_eligible",
      "The managed run does not match its exact canary authorization.",
    );
  }
}
