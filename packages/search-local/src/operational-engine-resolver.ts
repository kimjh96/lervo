import {
  assertSearchResponse,
  baselineSearchEngineSelection,
  identifySearchQuery,
  LexicalSearchIndex,
  SEARCH_MAX_RESULTS,
  SearchError,
  sameSearchEngine,
  type SearchEngineSelection,
  type SearchEvaluationEngineRegistry,
  type SearchIndexPort,
  type SearchResponse,
} from "@lervo/search";

import { loadRegisteredDocumentCorpus } from "./corpus.js";
import { verifySearchCandidateActivationEvidence } from "./engine-activation-evidence.js";
import { loadSearchEngineActivationHistory } from "./engine-activation-store.js";
import { verifySearchEngineSelectionHistory } from "./engine-selection-history-verifier.js";
import { SearchLocalError } from "./types.js";

export interface ResolvedOperationalSearchEngine {
  selection: SearchEngineSelection;
  selectionTransitionId: string | null;
  transitionCount: number;
  index: SearchIndexPort;
}

export interface OperationalSearchResult {
  selection: SearchEngineSelection;
  selectionTransitionId: string | null;
  response: SearchResponse;
}

export async function resolveOperationalSearchEngine(input: {
  repositoryRoot: string;
  projectId: string;
  registry: SearchEvaluationEngineRegistry;
}): Promise<ResolvedOperationalSearchEngine> {
  const history = await loadSearchEngineActivationHistory(input.repositoryRoot);
  const current = history.at(-1) ?? null;
  if (current === null) {
    return {
      selection: baselineSearchEngineSelection(),
      selectionTransitionId: null,
      transitionCount: 0,
      index: new LexicalSearchIndex(await loadRegisteredDocumentCorpus(input.repositoryRoot)),
    };
  }
  try {
    await verifySearchEngineSelectionHistory({ ...input, history });
  } catch (error) {
    if (error instanceof SearchLocalError && error.code === "engine_selection_unavailable") throw error;
    throw new SearchLocalError("engine_selection_unavailable", "검색 엔진 선택 chain을 안전하게 검증하지 못했습니다.", {
      cause: error instanceof Error ? error : undefined,
    });
  }
  const selection = current.selected;
  if (selection.mode === "baseline") {
    return {
      selection,
      selectionTransitionId: current.activationId,
      transitionCount: history.length,
      index: new LexicalSearchIndex(await loadRegisteredDocumentCorpus(input.repositoryRoot)),
    };
  }
  try {
    const evidence = await verifySearchCandidateActivationEvidence({
      repositoryRoot: input.repositoryRoot,
      projectId: input.projectId,
      reviewId: selection.reviewId!,
      registry: input.registry,
    });
    const index = await evidence.engine.buildIndex(evidence.corpus);
    if (!sameSearchEngine(index.engine, selection.engine) || index.indexId !== evidence.comparison.candidate.indexId) {
      throw new SearchLocalError("engine_selection_unavailable", "선택된 검색 엔진의 현재 index가 검증된 비교 원본과 다릅니다.");
    }
    return { selection, selectionTransitionId: current.activationId, transitionCount: history.length, index };
  } catch (error) {
    if (error instanceof SearchLocalError && error.code === "engine_selection_unavailable") throw error;
    throw new SearchLocalError("engine_selection_unavailable", "현재 후보 검색 엔진 선택을 안전하게 사용할 수 없습니다.", {
      cause: error instanceof Error ? error : undefined,
    });
  }
}

export async function runLocalOperationalSearch(input: {
  repositoryRoot: string;
  projectId: string;
  registry: SearchEvaluationEngineRegistry;
  query: string;
  limit: number;
}): Promise<OperationalSearchResult> {
  if (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > SEARCH_MAX_RESULTS) {
    throw new SearchError("invalid_query", `검색 결과 한도는 1 이상 ${SEARCH_MAX_RESULTS} 이하여야 합니다.`);
  }
  identifySearchQuery(input.query);
  const resolved = await resolveOperationalSearchEngine(input);
  try {
    const response = await resolved.index.search(input.query, input.limit);
    assertSearchResponse({ response, index: resolved.index, query: input.query, limit: input.limit });
    return {
      selection: structuredClone(resolved.selection),
      selectionTransitionId: resolved.selectionTransitionId,
      response,
    };
  } catch (error) {
    throw new SearchLocalError("engine_selection_unavailable", "선택된 검색 엔진이 유효한 응답을 만들지 못했습니다.", {
      cause: error instanceof Error ? error : undefined,
    });
  }
}
