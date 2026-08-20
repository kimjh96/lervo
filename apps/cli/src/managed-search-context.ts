import { randomBytes } from "node:crypto";

import {
  createSearchAttempt,
  createSearchRecommendationBatch,
  LexicalSearchIndex,
  normalizeSearchText,
  type SearchAttempt,
  type SearchRecommendationBatch,
} from "@lervo/search";
import {
  loadRegisteredDocumentCorpus,
  LocalSearchObservationStore,
} from "@lervo/search-local";
import type { ContextEvidence } from "@lervo/schemas";

export interface ManagedSearchContextSummary {
  attemptId: string;
  recommendedDocuments: number;
  selectedDocuments: number;
  selectedDocumentIds: string[];
}

export interface PreparedManagedSearchContext {
  attempt: SearchAttempt;
  recommendationBatch: SearchRecommendationBatch;
}

export function managedSearchQuery(query: string, fallbackQuery: string): string {
  const terms = normalizeSearchText(query).match(/[\p{L}\p{N}]+/gu) ??
    normalizeSearchText(fallbackQuery).match(/[\p{L}\p{N}]+/gu) ?? [];
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
    throw new TypeError("작업 문장과 예상 경로에서 검색 가능한 문자·숫자 단어를 찾지 못했습니다.");
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
}): Promise<PreparedManagedSearchContext> {
  const response = new LexicalSearchIndex(
    await loadRegisteredDocumentCorpus(input.repositoryRoot),
  ).search(managedSearchQuery(input.query, input.fallbackQuery), 5);
  const attempt = createSearchAttempt({
    projectId: input.projectId,
    observedAt: input.observedAt,
    nonce: input.nonce ?? randomBytes(16).toString("hex"),
    response,
  });
  const store = await LocalSearchObservationStore.open(input.repositoryRoot);
  await store.recordAttempt(attempt);
  return {
    attempt,
    recommendationBatch: createSearchRecommendationBatch({
      attempt,
      recommendationLimit: 5,
      maximumSelections: 3,
    }),
  };
}

export function summarizeManagedSearchContext(
  attemptId: string,
  evidence: readonly ContextEvidence[],
): ManagedSearchContextSummary {
  const recommendedDocumentIds = new Set(evidence
    .filter((item) => item.state === "recommended")
    .map((item) => item.documentId));
  const selectedDocumentIds = [...new Set(evidence
    .filter((item) => item.state === "selected" && item.reasonCode === "search_recommendation")
    .map((item) => item.documentId))].sort();
  return {
    attemptId,
    recommendedDocuments: recommendedDocumentIds.size,
    selectedDocuments: selectedDocumentIds.length,
    selectedDocumentIds,
  };
}
