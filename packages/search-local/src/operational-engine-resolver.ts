import {
  assertSearchResponse,
  baselineSearchEngineSelection,
  identifySearchQuery,
  LexicalSearchIndex,
  SEARCH_MAX_RESULTS,
  SearchError,
  sameSearchEngine,
  type SearchCandidateEngineResolver,
  type SearchCandidateVerificationReceipt,
  type SearchEngineSelection,
  type SearchEngineActivation,
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
  verificationReceipt: SearchCandidateVerificationReceipt | null;
}

export interface OperationalSearchResult {
  selection: SearchEngineSelection;
  selectionTransitionId: string | null;
  response: SearchResponse;
  verificationReceiptId: string | null;
}

export interface OperationalSearchEngineInspection {
  selection: SearchEngineSelection;
  selectionTransitionId: string | null;
  transitions: number;
  resolverState: "ready" | "unavailable";
  failureCode: string | null;
  verificationReceiptId: string | null;
}

async function resolveOperationalSearchEngineFromHistory(input: {
  repositoryRoot: string;
  projectId: string;
  registry: SearchCandidateEngineResolver;
  history: readonly SearchEngineActivation[];
}): Promise<ResolvedOperationalSearchEngine> {
  const history = input.history;
  const current = history.at(-1) ?? null;
  if (current === null) {
    return {
      selection: baselineSearchEngineSelection(),
      selectionTransitionId: null,
      transitionCount: 0,
      index: new LexicalSearchIndex(await loadRegisteredDocumentCorpus(input.repositoryRoot)),
      verificationReceipt: null,
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
      verificationReceipt: null,
    };
  }
  try {
    const evidence = await verifySearchCandidateActivationEvidence({
      repositoryRoot: input.repositoryRoot,
      projectId: input.projectId,
      reviewId: selection.reviewId!,
      registry: input.registry,
    });
    const index = evidence.index;
    if (!sameSearchEngine(index.engine, selection.engine) || index.indexId !== evidence.comparison.candidate.indexId) {
      throw new SearchLocalError("engine_selection_unavailable", "선택된 검색 엔진의 현재 index가 검증된 비교 원본과 다릅니다.");
    }
    return {
      selection,
      selectionTransitionId: current.activationId,
      transitionCount: history.length,
      index,
      verificationReceipt: evidence.verificationReceipt,
    };
  } catch (error) {
    if (error instanceof SearchLocalError && error.code === "engine_selection_unavailable") throw error;
    throw new SearchLocalError("engine_selection_unavailable", "현재 후보 검색 엔진 선택을 안전하게 사용할 수 없습니다.", {
      cause: error instanceof Error ? error : undefined,
    });
  }
}

export async function resolveOperationalSearchEngine(input: {
  repositoryRoot: string;
  projectId: string;
  registry: SearchCandidateEngineResolver;
}): Promise<ResolvedOperationalSearchEngine> {
  return resolveOperationalSearchEngineFromHistory({
    ...input,
    history: await loadSearchEngineActivationHistory(input.repositoryRoot),
  });
}

export async function inspectOperationalSearchEngine(input: {
  repositoryRoot: string;
  projectId: string;
  registry: SearchCandidateEngineResolver;
}): Promise<OperationalSearchEngineInspection> {
  const history = await loadSearchEngineActivationHistory(input.repositoryRoot);
  const current = history.at(-1) ?? null;
  const recorded = {
    selection: structuredClone(current?.selected ?? baselineSearchEngineSelection()),
    selectionTransitionId: current?.activationId ?? null,
    transitions: history.length,
  };
  try {
    const resolved = await resolveOperationalSearchEngineFromHistory({ ...input, history });
    return {
      ...recorded,
      resolverState: "ready",
      failureCode: null,
      verificationReceiptId: resolved.verificationReceipt?.receiptId ?? null,
    };
  } catch (error) {
    return {
      ...recorded,
      resolverState: "unavailable",
      failureCode: typeof error === "object" && error !== null && "code" in error &&
        typeof error.code === "string" ? error.code : "engine_selection_unavailable",
      verificationReceiptId: null,
    };
  }
}

export async function runLocalOperationalSearch(input: {
  repositoryRoot: string;
  projectId: string;
  registry: SearchCandidateEngineResolver;
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
      verificationReceiptId: resolved.verificationReceipt?.receiptId ?? null,
    };
  } catch (error) {
    throw new SearchLocalError("engine_selection_unavailable", "선택된 검색 엔진이 유효한 응답을 만들지 못했습니다.", {
      cause: error instanceof Error ? error : undefined,
    });
  }
}
