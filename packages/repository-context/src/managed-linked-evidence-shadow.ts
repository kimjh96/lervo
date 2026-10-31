import { createHash } from "node:crypto";

import {
  LinkedEvidenceShadowError,
  projectLinkedEvidenceShadow,
  type LinkedEvidenceShadowSource,
} from "@lervo/context";
import {
  assertSearchRecommendationBatch,
  sameSearchEngine,
  SEARCH_ENGINE,
  type SearchRecommendationBatch,
} from "@lervo/search";
import {
  createLinkedEvidenceShadowObservation,
  loadRegisteredDocumentCorpus,
  LocalLinkedEvidenceShadowStore,
  type LinkedEvidenceShadowObservation,
} from "@lervo/search-local";

function digest(value: unknown): string {
  return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}

export async function observeManagedLinkedEvidenceShadow(input: {
  repositoryRoot: string;
  projectId: string;
  runId: string;
  observedAt: Date;
  operationalBatch: SearchRecommendationBatch;
  recommendationBatches: readonly SearchRecommendationBatch[];
}): Promise<void> {
  try {
    await recordManagedLinkedEvidenceShadow(input);
  } catch {
    // The shadow has no authority over the independently valid managed run.
  }
}

async function recordManagedLinkedEvidenceShadow(input: {
  repositoryRoot: string;
  projectId: string;
  runId: string;
  observedAt: Date;
  operationalBatch: SearchRecommendationBatch;
  recommendationBatches: readonly SearchRecommendationBatch[];
}): Promise<void> {
  assertSearchRecommendationBatch(input.operationalBatch);
  if (!sameSearchEngine(input.operationalBatch.attempt.engine, SEARCH_ENGINE)) return;
  const selectedIds = new Set(input.operationalBatch.selectedRecommendationIds);
  const selectedRecommendations = input.operationalBatch.recommendations.filter((item) =>
    selectedIds.has(item.recommendationId),
  );
  const base = {
    projectId: input.projectId,
    runId: input.runId,
    observedAt: input.observedAt.toISOString(),
    engine: structuredClone(input.operationalBatch.attempt.engine),
    indexId: input.operationalBatch.attempt.indexId,
    selectionTransitionId: input.operationalBatch.attempt.selectionTransitionId,
    recommendationBatchId: input.operationalBatch.batchId,
    resultSetHash: input.operationalBatch.attempt.resultSetHash,
    recommendationCount: selectedRecommendations.length,
  };
  let observation: LinkedEvidenceShadowObservation;
  try {
    for (const batch of input.recommendationBatches) assertSearchRecommendationBatch(batch);
    if (
      input.operationalBatch.selectionPolicy.maximumSelections !== 3 ||
      selectedRecommendations.length > 3
    ) {
      throw new LinkedEvidenceShadowError(
        "shadow_bound_invalid",
        "The managed recommendation bound differs from linked-evidence-shadow-v1.",
      );
    }
    const corpus = (await loadRegisteredDocumentCorpus(input.repositoryRoot)).map(
      (source): LinkedEvidenceShadowSource => {
        if (source.kind !== "document" || source.path === undefined) {
          throw new LinkedEvidenceShadowError(
            "shadow_source_unavailable",
            "A registered shadow source has no document path.",
          );
        }
        return {
          documentId: source.sourceId,
          path: source.path,
          contentHash: source.contentHash,
          text: source.text,
        };
      },
    );
    const corpusByDocumentId = new Map(corpus.map((source) => [source.documentId, source]));
    const recommendations = selectedRecommendations.map((recommendation) => {
      const source = corpusByDocumentId.get(recommendation.documentId);
      if (source === undefined || source.contentHash !== recommendation.sourceContentHash) {
        throw new LinkedEvidenceShadowError(
          "shadow_source_unavailable",
          "A selected recommendation differs from the registered shadow corpus.",
        );
      }
      return source;
    });
    const ordinaryDocumentIds = new Set([
      ...input.recommendationBatches.flatMap((batch) =>
        batch.recommendations.map((item) => item.documentId),
      ),
    ]);
    const existingPaths = corpus
      .filter((source) => ordinaryDocumentIds.has(source.documentId))
      .map((source) => source.path);
    const projection = projectLinkedEvidenceShadow({ corpus, recommendations, existingPaths });
    observation = createLinkedEvidenceShadowObservation({
      ...base,
      sourceSnapshotId: projection.sourceSnapshotId,
      candidateCount: projection.candidateCount,
      retainedCount: projection.sources.length,
      ignoredCount: projection.ignoredCount,
      truncated: projection.truncated,
      retainedByteCount: projection.byteCount,
      projectionDigest: projection.projectionDigest,
      retained: projection.sources.map(({ documentId, contentHash }) => ({
        documentId,
        contentHash,
      })),
      status: "observed",
      failureCode: null,
    });
  } catch (error) {
    const failureCode =
      error instanceof LinkedEvidenceShadowError
        ? error.code
        : ("shadow_source_unavailable" as const);
    observation = createLinkedEvidenceShadowObservation({
      ...base,
      sourceSnapshotId: digest({ indexId: base.indexId, resultSetHash: base.resultSetHash }),
      candidateCount: 0,
      retainedCount: 0,
      ignoredCount: 0,
      truncated: false,
      retainedByteCount: 0,
      projectionDigest: digest({
        policy: "linked-evidence-shadow-v1",
        recommendationBatchId: base.recommendationBatchId,
        failureCode,
      }),
      retained: [],
      status: "unavailable",
      failureCode,
    });
  }
  const store = await LocalLinkedEvidenceShadowStore.open(input.repositoryRoot);
  await store.record(observation);
}
