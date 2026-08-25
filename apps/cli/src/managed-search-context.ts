import { createHash, randomBytes } from "node:crypto";

import {
  documentIdForPath,
  instructionPathsFor,
  readRepositoryFile,
  type ContextDocumentCandidate,
} from "@lervo/context";
import { queryRepositoryKnowledge } from "@lervo/repository-knowledge";
import {
  createSearchAttempt,
  createSearchRecommendationBatch,
  LexicalSearchIndex,
  normalizeSearchText,
  type SearchCandidateEngineResolver,
  type SearchAttempt,
  type SearchRecommendationBatch,
} from "@lervo/search";
import { LocalSearchObservationStore, runLocalOperationalSearch } from "@lervo/search-local";
import type { ContextEvidence } from "@lervo/schemas";
import type { DocumentRegistry } from "@lervo/schemas";

import { collectLocalKnowledgeSources } from "./knowledge-sources.js";
import { searchCandidateRegistry } from "./search-candidate-registry.js";

export interface ManagedSearchContextSummary {
  attemptId: string;
  knowledgeAttemptId: string;
  recommendedDocuments: number;
  selectedDocuments: number;
  selectedDocumentIds: string[];
  recommendedKnowledgeConcepts: number;
  selectedKnowledgeConcepts: number;
  selectedKnowledgeConceptIds: string[];
}

export interface PreparedManagedSearchContext {
  attempt: SearchAttempt;
  recommendationBatch: SearchRecommendationBatch;
  attempts: readonly SearchAttempt[];
  recommendationBatches: readonly SearchRecommendationBatch[];
  additionalCandidates: readonly ContextDocumentCandidate[];
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
    if (selected.length === 0) {
      selected.push(term.slice(0, 500).replace(/[\uD800-\uDBFF]$/u, ""));
    }
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
  documentRegistry?: DocumentRegistry;
  expectedPaths?: readonly string[];
}): Promise<PreparedManagedSearchContext> {
  const query = managedSearchQuery(input.query, input.fallbackQuery);
  const nonce = input.nonce ?? randomBytes(16).toString("hex");
  const operational = await runLocalOperationalSearch({
    repositoryRoot: input.repositoryRoot,
    projectId: input.projectId,
    registry: input.registry ?? searchCandidateRegistry,
    query,
    limit: 5,
  });
  const response = operational.response;
  const attempt = createSearchAttempt({
    projectId: input.projectId,
    observedAt: input.observedAt,
    nonce,
    response,
    selectionTransitionId: operational.selectionTransitionId,
  });
  const store = await LocalSearchObservationStore.open(input.repositoryRoot);
  await store.recordAttempt(attempt);
  const supplementalSources = await collectLocalKnowledgeSources(input.repositoryRoot);
  const knowledge = await queryRepositoryKnowledge({
    repositoryRoot: input.repositoryRoot,
    query,
    limit: 20,
    supplementalSources,
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
  return {
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

export function summarizeManagedSearchContext(
  attemptId: string,
  knowledgeAttemptId: string,
  evidence: readonly ContextEvidence[],
): ManagedSearchContextSummary {
  const recommendedDocumentIds = new Set(
    evidence.filter((item) => item.state === "recommended").map((item) => item.documentId),
  );
  const selectedDocumentIds = [
    ...new Set(
      evidence
        .filter((item) => item.state === "selected" && item.reasonCode === "search_recommendation")
        .map((item) => item.documentId),
    ),
  ].sort();
  const selectedKnowledgeConceptIds = [
    ...new Set(
      evidence
        .filter((item) => item.state === "selected" && item.reasonCode === "search_recommendation")
        .flatMap((item) =>
          item.knowledgeContext === undefined ? [] : [item.knowledgeContext.conceptId],
        ),
    ),
  ].sort();
  const recommendedKnowledgeConceptIds = new Set(
    evidence
      .filter((item) => item.state === "recommended")
      .flatMap((item) =>
        item.knowledgeContext === undefined ? [] : [item.knowledgeContext.conceptId],
      ),
  );
  return {
    attemptId,
    knowledgeAttemptId,
    recommendedDocuments: recommendedDocumentIds.size,
    selectedDocuments: selectedDocumentIds.length,
    selectedDocumentIds,
    recommendedKnowledgeConcepts: recommendedKnowledgeConceptIds.size,
    selectedKnowledgeConcepts: selectedKnowledgeConceptIds.length,
    selectedKnowledgeConceptIds,
  };
}
