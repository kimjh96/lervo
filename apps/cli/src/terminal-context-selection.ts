import {
  loadStoredConcepts,
  queryRepositoryKnowledge,
  scanConfiguredRepositoryKnowledge,
  type RepositorySupplementalSource,
} from "@lervo/repository-knowledge";
import {
  executeProjectedSearch,
  queryCoverageInterleave,
  sameSearchEngine,
  type SearchQueryProjection,
} from "@lervo/search";
import { resolveOperationalSearchRetrievalPlan } from "@lervo/search-local";

import { createRepositoryKnowledgeSearchCorpus } from "./repository-search-corpus.js";
import { searchCandidateRegistry } from "./search-candidate-registry.js";
import type { RunProvider } from "./managed-run.js";

async function selectOperationalPlanCandidates(input: {
  repositoryRoot: string;
  projectId: string;
  provider: RunProvider;
  projection: SearchQueryProjection;
  supplementalSources: RepositorySupplementalSource[];
}) {
  const operational = await resolveOperationalSearchRetrievalPlan({
    repositoryRoot: input.repositoryRoot,
    projectId: input.projectId,
  });
  if (operational.bundle === null) return null;
  const plan = operational.bundle.plan;
  const population = plan.projection.populations.find(
    (item) => item.populationId === `provider.${input.provider}`,
  );
  const receipt = input.projection.receipt;
  if (
    population === undefined ||
    receipt.status !== "completed" ||
    population.projector.id !== receipt.projector.id ||
    population.projector.version !== receipt.projector.version ||
    population.projector.buildId !== receipt.projector.buildId ||
    receipt.limits.maximumQueries !== plan.projection.maximumQueries ||
    receipt.limits.maximumQueryCharacters !== plan.projection.maximumQueryCharacters
  ) {
    throw new Error("The selected retrieval plan does not match the current query projector.");
  }
  const { scan } = await scanConfiguredRepositoryKnowledge(input.repositoryRoot, {
    supplementalSources: input.supplementalSources,
  });
  const corpus = createRepositoryKnowledgeSearchCorpus(scan);
  const reviewedCorpus = operational.bundle.review.corpus;
  if (
    corpus.digest !== reviewedCorpus.digest ||
    corpus.documentCount !== reviewedCorpus.documentCount ||
    corpus.byteCount !== reviewedCorpus.byteCount
  ) {
    throw new Error("The selected retrieval-plan Markdown corpus differs from its review.");
  }
  const engine = searchCandidateRegistry.resolve(plan.retrieval.candidateId);
  if (
    !sameSearchEngine(engine.engine, plan.retrieval.engine) ||
    engine.adapterBuildId !== plan.retrieval.adapterBuildId
  ) {
    throw new Error("The selected retrieval-plan adapter build is unavailable.");
  }
  const index = await engine.buildIndex(corpus.sources);
  const execution = await executeProjectedSearch({
    projection: input.projection,
    index,
    perQueryLimit: plan.retrieval.perQueryLimit,
    finalLimit: plan.finalLimit,
    fusionPolicy: plan.fusion.algorithm,
  });
  const conceptsByPath = new Map<string, Awaited<ReturnType<typeof loadStoredConcepts>>[number]>();
  for (const stored of await loadStoredConcepts(input.repositoryRoot)) {
    if (stored.value === null || stored.value.publicationStatus === "deprecated") continue;
    if (conceptsByPath.has(stored.value.path)) {
      throw new Error("The selected retrieval-plan source has ambiguous concept coordinates.");
    }
    conceptsByPath.set(stored.value.path, stored);
  }
  const candidates = execution.hits.map((hit) => {
    const path = hit.source.path;
    const stored = path === undefined ? undefined : conceptsByPath.get(path);
    if (path === undefined || stored?.value === null || stored?.value === undefined) {
      throw new Error("The selected retrieval-plan source is not registered as current knowledge.");
    }
    return {
      conceptId: stored.value.conceptId,
      title: stored.value.title,
      path,
      ownership: stored.value.ownership,
      score: hit.fusionScore,
      matchedTerms: [],
      assurance: stored.value.assurance ?? ("unreviewed" as const),
      freshness: stored.value.freshness ?? ("unknown" as const),
      contentHash: hit.source.contentHash,
    };
  });
  return {
    sourceSnapshotId: scan.snapshotId,
    candidates,
    selected: candidates.slice(0, 6),
    disposition: candidates.length === 0 ? ("no_candidates" as const) : ("selected" as const),
    retrievalPlanId: plan.planId,
    retrievalPlanTransitionId: operational.selectionTransitionId,
  };
}

/** Candidate retrieval consumes only a validated semantic query and never raw request text. */
export async function selectTerminalContextCandidates(input: {
  repositoryRoot: string;
  projectId: string;
  provider: RunProvider;
  projection: SearchQueryProjection;
  retrievalQueries: readonly string[];
  sourceSnapshotId: string;
  supplementalSources: RepositorySupplementalSource[];
}) {
  const operational = await selectOperationalPlanCandidates(input);
  if (operational !== null) return operational;
  if (input.retrievalQueries.length === 0) {
    return {
      sourceSnapshotId: input.sourceSnapshotId,
      candidates: [],
      selected: [],
      disposition: "query_projection_missing" as const,
      retrievalPlanId: null,
      retrievalPlanTransitionId: null,
    };
  }
  const results = await Promise.all(
    input.retrievalQueries.map((query) =>
      queryRepositoryKnowledge({
        repositoryRoot: input.repositoryRoot,
        query,
        limit: 50,
        supplementalSources: input.supplementalSources,
      }),
    ),
  );
  const retrievalSnapshotId = results[0]!.sourceSnapshotId;
  if (results.some((result) => result.sourceSnapshotId !== retrievalSnapshotId)) {
    throw new Error("Repository knowledge changed during projected-query retrieval.");
  }
  const coordinates = new Map<string, { path: string; contentHash: string }>();
  for (const result of results) {
    for (const hit of result.hits) {
      const existing = coordinates.get(hit.conceptId);
      if (
        existing !== undefined &&
        (existing.path !== hit.path || existing.contentHash !== hit.contentHash)
      ) {
        throw new Error("A projected-query result changed between retrieval stages.");
      }
      coordinates.set(hit.conceptId, { path: hit.path, contentHash: hit.contentHash });
    }
  }
  const fusion = queryCoverageInterleave(
    results.map((result) => result.hits.map((hit) => ({ key: hit.conceptId, value: hit }))),
    6,
  );
  return {
    sourceSnapshotId: retrievalSnapshotId,
    candidates: fusion.values,
    selected: fusion.values,
    disposition: fusion.values.length === 0 ? ("no_candidates" as const) : ("selected" as const),
    retrievalPlanId: null,
    retrievalPlanTransitionId: null,
  };
}
