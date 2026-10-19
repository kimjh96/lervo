import { withRetrievalPreparationBudget } from "./retrieval-preparation-budget.js";
import { observeSearchPreparation } from "./search-preparation-observation.js";
import { randomBytes } from "node:crypto";

import { createSearchAttempt, createSearchRecommendationBatch } from "@lervo/search";
import { LocalSearchObservationStore, runLocalOperationalSearch } from "@lervo/search-local";

import { observeManagedLinkedEvidenceShadow } from "./managed-linked-evidence-shadow.js";
import { managedSearchQuery } from "./managed-search-context.js";
import { searchCandidateRegistry } from "./search-candidate-registry.js";
import type { ProductDefaultSearchEngine, SearchCandidateEngineResolver } from "@lervo/search";

/** Conversation reads can still use operational search while knowledge materialization is active. */
export async function prepareManagedOperationalSearchContext(input: {
  repositoryRoot: string;
  projectId: string;
  query: string;
  fallbackQuery: string;
  observedAt: Date;
  nonce?: string;
  registry?: SearchCandidateEngineResolver;
  productDefault?: ProductDefaultSearchEngine;
  runId?: string;
}) {
  const query = managedSearchQuery(input.query, input.fallbackQuery);
  const operational = await withRetrievalPreparationBudget(() =>
    runLocalOperationalSearch({
      repositoryRoot: input.repositoryRoot,
      projectId: input.projectId,
      registry: input.registry ?? searchCandidateRegistry,
      ...(input.productDefault === undefined ? {} : { productDefault: input.productDefault }),
      query,
      limit: 5,
    }),
  );
  const attempt = createSearchAttempt({
    projectId: input.projectId,
    observedAt: input.observedAt,
    nonce: input.nonce ?? randomBytes(16).toString("hex"),
    response: operational.response,
    selectionTransitionId: operational.selectionTransitionId,
    productQualificationId: operational.productQualificationId,
  });
  const store = await LocalSearchObservationStore.open(input.repositoryRoot);
  await store.recordAttempt(attempt);
  const batch = createSearchRecommendationBatch({
    attempt,
    recommendationLimit: 5,
    maximumSelections: 3,
  });
  if (input.runId !== undefined) {
    await observeManagedLinkedEvidenceShadow({
      repositoryRoot: input.repositoryRoot,
      projectId: input.projectId,
      runId: input.runId,
      observedAt: input.observedAt,
      operationalBatch: batch,
      recommendationBatches: [batch],
    });
  }
  return {
    preparationQuality: observeSearchPreparation({
      query,
      sourceSnapshotId: null,
      corpusCoverage: "incomplete",
      recommendationBatches: [batch],
    }),
    recommendationBatches: [batch],
    additionalCandidates: [],
  };
}
