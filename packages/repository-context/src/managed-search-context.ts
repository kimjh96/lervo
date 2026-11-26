import { withRetrievalPreparationBudget } from "./retrieval-preparation-budget.js";
import { prepareRepositoryQualityContext } from "./repository-quality-context.js";
import type { ContextQualityPreparationResult } from "./context-quality-preparation.js";
import { createHash, randomBytes } from "node:crypto";

import {
  projectTaskQuery,
  documentIdForPath,
  instructionPathsFor,
  readRepositoryFile,
  type ContextDocumentCandidate,
  MAX_CONTEXT_SOURCE_BYTES,
} from "@lervo/context";
import { queryRepositoryKnowledge } from "@lervo/repository-knowledge";
import type { KnowledgeQueryResult } from "@lervo/repository-knowledge";
import {
  createSearchAttempt,
  createSearchRecommendationBatch,
  LexicalSearchIndex,
  type SearchAttempt,
  type SearchCandidateEngineResolver,
  type ProductDefaultSearchEngine,
  type SearchRecommendationBatch,
} from "@lervo/search";
import { LocalSearchObservationStore, runLocalOperationalSearch } from "@lervo/search-local";
import type { ContextPreparationReport, DocumentRegistry } from "@lervo/schemas";

import { observeSearchPreparation } from "./search-preparation-observation.js";

import { collectLocalKnowledgeSources } from "./knowledge-sources.js";
import { searchCandidateRegistry } from "./search-candidate-registry.js";
import { productDefaultRepositoryKnowledgeRanker } from "./repository-knowledge-ranker.js";

export interface PreparedManagedSearchContext {
  preparationQuality: ContextPreparationReport;
  quality: ContextQualityPreparationResult;
  attempt: SearchAttempt;
  recommendationBatch: SearchRecommendationBatch;
  attempts: readonly SearchAttempt[];
  recommendationBatches: readonly SearchRecommendationBatch[];
  additionalCandidates: readonly ContextDocumentCandidate[];
  knowledgeAttempt: SearchAttempt;
}

export type ManagedRepositoryKnowledgeQuery = (input: {
  repositoryRoot: string;
  query: string;
  limit: number;
}) => Promise<KnowledgeQueryResult>;

function digestBytes(bytes: Uint8Array): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function knowledgeDocumentId(conceptId: string): string {
  return `doc_knowledge_${createHash("sha256").update(conceptId).digest("hex").slice(0, 24)}`;
}

function derivedNonce(nonce: string): string {
  return createHash("sha256").update(`${nonce}:repository-knowledge`).digest("hex").slice(0, 32);
}

export function managedSearchQuery(query: string, fallbackQuery: string): string {
  return projectTaskQuery({ intent: /[\p{L}\p{N}]/u.test(query) ? query : fallbackQuery }).query;
}

export async function prepareManagedSearchContext(input: {
  repositoryRoot: string;
  projectId: string;
  query: string;
  fallbackQuery: string;
  observedAt: Date;
  nonce?: string;
  registry?: SearchCandidateEngineResolver;
  productDefault?: ProductDefaultSearchEngine;
  documentRegistry?: DocumentRegistry;
  expectedPaths?: readonly string[];
  recordingCoordinates?: { runId: string; sessionId: string };
  knowledgeQuery?: ManagedRepositoryKnowledgeQuery;
  continuation?: string;
  origin?: "managed_run" | "conversation" | "native_chat";
  artifactKinds?: readonly string[];
  requestedActions?: readonly string[];
}): Promise<PreparedManagedSearchContext> {
  const query = projectTaskQuery({
    intent: /[\p{L}\p{N}]/u.test(input.query) ? input.query : input.fallbackQuery,
    continuation: input.continuation ?? "",
    targetPaths: input.expectedPaths ?? [],
  }).query;
  const nonce = input.nonce ?? randomBytes(16).toString("hex");
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
    nonce,
    response: operational.response,
    selectionTransitionId: operational.selectionTransitionId,
    productQualificationId: operational.productQualificationId,
  });
  const store = await LocalSearchObservationStore.open(input.repositoryRoot);
  await store.recordAttempt(attempt);
  const knowledgeQuery: ManagedRepositoryKnowledgeQuery =
    input.knowledgeQuery ??
    (async (knowledgeInput) => {
      const supplementalSources = await collectLocalKnowledgeSources(knowledgeInput.repositoryRoot);
      return queryRepositoryKnowledge({
        ...knowledgeInput,
        supplementalSources,
        ranker: productDefaultRepositoryKnowledgeRanker,
      });
    });
  const knowledge = await withRetrievalPreparationBudget(() =>
    knowledgeQuery({
      repositoryRoot: input.repositoryRoot,
      query,
      limit: 20,
    }),
  );
  const documentIdByPath = new Map(
    Object.entries(input.documentRegistry?.documents ?? {}).map(([documentId, document]) => [
      document.path,
      documentId,
    ]),
  );
  for (const path of instructionPathsFor(input.expectedPaths ?? [])) {
    if (!documentIdByPath.has(path)) documentIdByPath.set(path, documentIdForPath(path));
  }
  const additionalCandidates: ContextDocumentCandidate[] = [];
  const knowledgeSources = await Promise.all(
    knowledge.hits.map(async (hit) => {
      const bytes = await readRepositoryFile(
        input.repositoryRoot,
        hit.path,
        MAX_CONTEXT_SOURCE_BYTES,
      );
      if (digestBytes(bytes) !== hit.contentHash) {
        throw new TypeError(`Publication bytes changed after the knowledge query: ${hit.path}`);
      }
      const documentId = documentIdByPath.get(hit.path) ?? knowledgeDocumentId(hit.conceptId);
      additionalCandidates.push({
        documentId,
        path: hit.path,
        connectedPaths: [],
        source: "knowledge",
        documentRole: "task_evidence",
        referenceEligible: true,
        knowledgeContext: {
          conceptId: hit.conceptId,
          assurance: hit.assurance,
          freshness: hit.freshness,
          sourceSnapshotId: knowledge.sourceSnapshotId,
          impactReportId: knowledge.impactReportId,
        },
      });
      return {
        kind: "document" as const,
        sourceId: documentId,
        contentHash: hit.contentHash,
        path: hit.path,
        title: hit.title,
        labels: ["repository_knowledge", hit.assurance, hit.freshness],
        text: new TextDecoder("utf-8", { fatal: true }).decode(bytes),
      };
    }),
  );
  const knowledgeIndex =
    operational.selection.mode === "baseline"
      ? new LexicalSearchIndex(knowledgeSources)
      : await (input.registry ?? searchCandidateRegistry)
          .resolve(operational.selection.candidateId)
          .buildIndex(knowledgeSources);
  const knowledgeResponse = await knowledgeIndex.search(query, 5);
  const knowledgeAttempt = createSearchAttempt({
    projectId: input.projectId,
    observedAt: input.observedAt,
    nonce: derivedNonce(nonce),
    response: knowledgeResponse,
    selectionTransitionId: operational.selectionTransitionId,
    productQualificationId: operational.productQualificationId,
  });
  await store.recordAttempt(knowledgeAttempt);
  const recommendationBatch = createSearchRecommendationBatch({
    attempt,
    recommendationLimit: 5,
    maximumSelections: 3,
  });
  const knowledgeRecommendationBatch = createSearchRecommendationBatch({
    attempt: knowledgeAttempt,
    recommendationLimit: 5,
    maximumSelections: 3,
  });
  const quality = await prepareRepositoryQualityContext({
    recordObservation: true,
    ...(input.recordingCoordinates ? { recordingCoordinates: input.recordingCoordinates } : {}),
    repositoryRoot: input.repositoryRoot,
    origin: input.origin ?? "managed_run",
    task: {
      intent: input.query || input.fallbackQuery,
      continuation: input.continuation ?? "",
      targetPaths: [...(input.expectedPaths ?? [])],
      artifactKinds: [...(input.artifactKinds ?? [])],
      requestedActions: [...(input.requestedActions ?? [])],
      conversationLocale: null,
      publicationLocale: null,
      retrievalLanguages: ["en"],
    },
    instructionMaximumBytes: 12 * 1024,
    evidenceMaximumBytes: 12 * 1024,
    retrieval: "completed",
    candidates: knowledge.hits.slice(0, 5),
    sourceSnapshotId: knowledge.sourceSnapshotId,
    retrievalBuildId: knowledge.ranking?.adapterBuildId ?? "",
    projectedQueries: [query],
  });
  return {
    quality: quality.result,
    preparationQuality: observeSearchPreparation({
      query,
      sourceSnapshotId: knowledge.sourceSnapshotId,
      recommendationBatches: [recommendationBatch, knowledgeRecommendationBatch],
    }),
    attempt,
    recommendationBatch,
    attempts: [attempt, knowledgeAttempt],
    recommendationBatches: [recommendationBatch, knowledgeRecommendationBatch],
    additionalCandidates: additionalCandidates.sort((left, right) =>
      left.path.localeCompare(right.path),
    ),
    knowledgeAttempt,
  };
}
