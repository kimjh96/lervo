import { createHash, randomBytes } from "node:crypto";

import {
  documentIdForPath,
  instructionPathsFor,
  readRepositoryFile,
  type ContextDocumentCandidate,
  type GraphDocumentRecommendation,
} from "@lervo/context";
import { queryRepositoryKnowledge } from "@lervo/repository-knowledge";
import {
  createSearchAttempt,
  createSearchRecommendationBatch,
  LexicalSearchIndex,
  normalizeSearchText,
  type SearchAttempt,
  type SearchCandidateEngineResolver,
  type ProductDefaultSearchEngine,
  type SearchRecommendationBatch,
} from "@lervo/search";
import { LocalSearchObservationStore, runLocalOperationalSearch } from "@lervo/search-local";
import type { DocumentRegistry } from "@lervo/schemas";

import { collectLocalKnowledgeSources } from "./knowledge-sources.js";
import { observeManagedLinkedEvidenceShadow } from "./managed-linked-evidence-shadow.js";
import { searchCandidateRegistry } from "./search-candidate-registry.js";

export interface PreparedManagedSearchContext {
  attempt: SearchAttempt;
  recommendationBatch: SearchRecommendationBatch;
  attempts: readonly SearchAttempt[];
  recommendationBatches: readonly SearchRecommendationBatch[];
  additionalCandidates: readonly ContextDocumentCandidate[];
  graphRecommendations: readonly GraphDocumentRecommendation[];
  knowledgeAttempt: SearchAttempt;
}

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
  const terms =
    normalizeSearchText(query).match(/[\p{L}\p{N}]+/gu) ??
    normalizeSearchText(fallbackQuery).match(/[\p{L}\p{N}]+/gu) ??
    [];
  const selected: string[] = [];
  for (const term of terms.slice(0, 32)) {
    const candidate = [...selected, term].join(" ");
    if (candidate.length <= 500) {
      selected.push(term);
      continue;
    }
    if (selected.length === 0) selected.push(term.slice(0, 500).replace(/[\uD800-\uDBFF]$/u, ""));
    break;
  }
  if (selected.length === 0 || selected[0]!.length === 0) {
    throw new TypeError(
      "No searchable alphanumeric terms were found in the task request and expected path.",
    );
  }
  return selected.join(" ");
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
  runId?: string;
}): Promise<PreparedManagedSearchContext> {
  const query = managedSearchQuery(input.query, input.fallbackQuery);
  const nonce = input.nonce ?? randomBytes(16).toString("hex");
  const operational = await runLocalOperationalSearch({
    repositoryRoot: input.repositoryRoot,
    projectId: input.projectId,
    registry: input.registry ?? searchCandidateRegistry,
    ...(input.productDefault === undefined ? {} : { productDefault: input.productDefault }),
    query,
    limit: 5,
  });
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
  const supplementalSources = await collectLocalKnowledgeSources(input.repositoryRoot);
  const knowledge = await queryRepositoryKnowledge({
    repositoryRoot: input.repositoryRoot,
    query,
    limit: 20,
    supplementalSources,
    ...(input.documentRegistry === undefined ? {} : { documentRegistry: input.documentRegistry }),
  });
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
      const bytes = await readRepositoryFile(input.repositoryRoot, hit.path, 131_072);
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
  const knowledgeResponse = new LexicalSearchIndex(knowledgeSources).search(query, 5);
  const knowledgeAttempt = createSearchAttempt({
    projectId: input.projectId,
    observedAt: input.observedAt,
    nonce: derivedNonce(nonce),
    response: knowledgeResponse,
    selectionTransitionId: null,
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
  const graphRecommendations: GraphDocumentRecommendation[] = [];
  for (const [index, recommendation] of knowledge.relationProjection.recommendations.entries()) {
    const bytes = await readRepositoryFile(input.repositoryRoot, recommendation.path, 131_072);
    if (digestBytes(bytes) !== recommendation.sourceContentHash) {
      throw new TypeError(
        `Publication bytes changed after relation projection: ${recommendation.path}`,
      );
    }
    const existing = additionalCandidates.find(
      (candidate) => candidate.documentId === recommendation.documentId,
    );
    if (
      existing !== undefined &&
      (existing.path !== recommendation.path ||
        existing.knowledgeContext?.conceptId !== recommendation.targetConceptId)
    ) {
      throw new TypeError(
        `A relation target conflicts with an existing knowledge document: ${recommendation.documentId}`,
      );
    }
    if (existing === undefined) {
      additionalCandidates.push({
        documentId: recommendation.documentId,
        path: recommendation.path,
        connectedPaths: [],
        source: "knowledge",
        documentRole: "task_evidence",
        referenceEligible: true,
        knowledgeContext: {
          conceptId: recommendation.targetConceptId,
          assurance: "human_reviewed",
          freshness: "current",
          sourceSnapshotId: recommendation.sourceSnapshotId,
          impactReportId: recommendation.impactReportId,
        },
      });
    }
    graphRecommendations.push({
      schemaVersion: 1,
      projectionId: knowledge.relationProjection.projectionId,
      recommendationId: recommendation.recommendationId,
      relationId: recommendation.relationId,
      targetConceptId: recommendation.targetConceptId,
      documentId: recommendation.documentId,
      path: recommendation.path,
      sourceContentHash: recommendation.sourceContentHash,
      sourceSnapshotId: recommendation.sourceSnapshotId,
      impactReportId: recommendation.impactReportId,
      rank: index + 1,
      selected: index < knowledge.relationProjection.limits.maximumSelections,
    });
  }
  if (input.runId !== undefined) {
    await observeManagedLinkedEvidenceShadow({
      repositoryRoot: input.repositoryRoot,
      projectId: input.projectId,
      runId: input.runId,
      observedAt: input.observedAt,
      operationalBatch: recommendationBatch,
      recommendationBatches: [recommendationBatch, knowledgeRecommendationBatch],
      graphRecommendations,
    });
  }
  return {
    attempt,
    recommendationBatch,
    attempts: [attempt, knowledgeAttempt],
    recommendationBatches: [recommendationBatch, knowledgeRecommendationBatch],
    additionalCandidates: additionalCandidates.sort((left, right) =>
      left.path.localeCompare(right.path),
    ),
    graphRecommendations,
    knowledgeAttempt,
  };
}
