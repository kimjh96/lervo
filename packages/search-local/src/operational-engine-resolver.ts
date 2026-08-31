import {
  assertProductDefaultSearchEngine,
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
  type ProductDefaultSearchEngine,
  type ProductDefaultSearchEngineSelection,
  type SearchIndexPort,
  type SearchResponse,
} from "@lervo/search";

import { loadRegisteredDocumentCorpus } from "./corpus.js";
import { verifySearchCandidateActivationEvidence } from "./engine-activation-evidence.js";
import { loadSearchEngineActivationHistory } from "./engine-activation-store.js";
import { verifySearchEngineSelectionHistory } from "./engine-selection-history-verifier.js";
import { SearchLocalError } from "./types.js";

export interface ResolvedOperationalSearchEngine {
  selection: OperationalSearchEngineSelection;
  selectionTransitionId: string | null;
  transitionCount: number;
  index: SearchIndexPort;
  verificationReceipt: SearchCandidateVerificationReceipt | null;
  productQualificationId: string | null;
}

export type OperationalSearchEngineSelection =
  SearchEngineSelection | ProductDefaultSearchEngineSelection;

export interface OperationalSearchResult {
  selection: OperationalSearchEngineSelection;
  selectionTransitionId: string | null;
  response: SearchResponse;
  verificationReceiptId: string | null;
  productQualificationId: string | null;
}

export interface OperationalSearchEngineInspection {
  selection: OperationalSearchEngineSelection;
  selectionTransitionId: string | null;
  transitions: number;
  resolverState: "ready" | "unavailable";
  failureCode: string | null;
  verificationReceiptId: string | null;
  productQualificationId: string | null;
}

async function resolveProductDefaultSearchEngine(input: {
  repositoryRoot: string;
  registry: SearchCandidateEngineResolver;
  productDefault: ProductDefaultSearchEngine;
}): Promise<ResolvedOperationalSearchEngine> {
  try {
    assertProductDefaultSearchEngine(input.productDefault);
    const engine = input.registry.resolve(input.productDefault.candidateId);
    if (
      !sameSearchEngine(engine.engine, input.productDefault.engine) ||
      engine.adapterBuildId !== input.productDefault.adapterBuildId
    ) {
      throw new Error("The registered engine differs from the product qualification.");
    }
    return {
      selection: {
        mode: "product_default",
        qualificationId: input.productDefault.qualificationId,
        candidateId: input.productDefault.candidateId,
        engine: { ...input.productDefault.engine },
        reviewId: null,
        comparisonId: null,
      },
      selectionTransitionId: null,
      transitionCount: 0,
      index: await engine.buildIndex(await loadRegisteredDocumentCorpus(input.repositoryRoot)),
      verificationReceipt: null,
      productQualificationId: input.productDefault.qualificationId,
    };
  } catch (error) {
    if (error instanceof SearchLocalError) throw error;
    throw new SearchLocalError(
      "engine_selection_unavailable",
      "The product-default search engine is unavailable.",
      { cause: error instanceof Error ? error : undefined },
    );
  }
}

async function resolveOperationalSearchEngineFromHistory(input: {
  repositoryRoot: string;
  projectId: string;
  registry: SearchCandidateEngineResolver;
  history: readonly SearchEngineActivation[];
  productDefault?: ProductDefaultSearchEngine;
}): Promise<ResolvedOperationalSearchEngine> {
  const history = input.history;
  const current = history.at(-1) ?? null;
  if (current === null) {
    if (input.productDefault !== undefined) {
      return resolveProductDefaultSearchEngine({
        repositoryRoot: input.repositoryRoot,
        registry: input.registry,
        productDefault: input.productDefault,
      });
    }
    return {
      selection: baselineSearchEngineSelection(),
      selectionTransitionId: null,
      transitionCount: 0,
      index: new LexicalSearchIndex(await loadRegisteredDocumentCorpus(input.repositoryRoot)),
      verificationReceipt: null,
      productQualificationId: null,
    };
  }
  try {
    await verifySearchEngineSelectionHistory({ ...input, history });
  } catch (error) {
    if (error instanceof SearchLocalError && error.code === "engine_selection_unavailable")
      throw error;
    throw new SearchLocalError(
      "engine_selection_unavailable",
      "Could not safely verify the search engine selection chain.",
      {
        cause: error instanceof Error ? error : undefined,
      },
    );
  }
  const selection = current.selected;
  if (selection.mode === "baseline") {
    return {
      selection,
      selectionTransitionId: current.activationId,
      transitionCount: history.length,
      index: new LexicalSearchIndex(await loadRegisteredDocumentCorpus(input.repositoryRoot)),
      verificationReceipt: null,
      productQualificationId: null,
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
    if (
      !sameSearchEngine(index.engine, selection.engine) ||
      index.indexId !== evidence.comparison.candidate.indexId
    ) {
      throw new SearchLocalError(
        "engine_selection_unavailable",
        "The current index of the selected search engine differs from the verified comparison source.",
      );
    }
    return {
      selection,
      selectionTransitionId: current.activationId,
      transitionCount: history.length,
      index,
      verificationReceipt: evidence.verificationReceipt,
      productQualificationId: null,
    };
  } catch (error) {
    if (error instanceof SearchLocalError && error.code === "engine_selection_unavailable")
      throw error;
    throw new SearchLocalError(
      "engine_selection_unavailable",
      "The current candidate search engine selection cannot be used safely.",
      {
        cause: error instanceof Error ? error : undefined,
      },
    );
  }
}

export async function resolveOperationalSearchEngine(input: {
  repositoryRoot: string;
  projectId: string;
  registry: SearchCandidateEngineResolver;
  productDefault?: ProductDefaultSearchEngine;
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
  productDefault?: ProductDefaultSearchEngine;
}): Promise<OperationalSearchEngineInspection> {
  const history = await loadSearchEngineActivationHistory(input.repositoryRoot);
  const current = history.at(-1) ?? null;
  const defaultSelection: OperationalSearchEngineSelection =
    input.productDefault === undefined
      ? baselineSearchEngineSelection()
      : {
          mode: "product_default",
          qualificationId: input.productDefault.qualificationId,
          candidateId: input.productDefault.candidateId,
          engine: { ...input.productDefault.engine },
          reviewId: null,
          comparisonId: null,
        };
  const recorded = {
    selection: structuredClone(current?.selected ?? defaultSelection),
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
      productQualificationId: resolved.productQualificationId,
    };
  } catch (error) {
    return {
      ...recorded,
      resolverState: "unavailable",
      failureCode:
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        typeof error.code === "string"
          ? error.code
          : "engine_selection_unavailable",
      verificationReceiptId: null,
      productQualificationId: null,
    };
  }
}

export async function runLocalOperationalSearch(input: {
  repositoryRoot: string;
  projectId: string;
  registry: SearchCandidateEngineResolver;
  productDefault?: ProductDefaultSearchEngine;
  query: string;
  limit: number;
}): Promise<OperationalSearchResult> {
  if (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > SEARCH_MAX_RESULTS) {
    throw new SearchError(
      "invalid_query",
      `The search result limit must be between 1 and ${SEARCH_MAX_RESULTS}.`,
    );
  }
  identifySearchQuery(input.query);
  const resolved = await resolveOperationalSearchEngine(input);
  try {
    const response = await resolved.index.search(input.query, input.limit);
    assertSearchResponse({
      response,
      index: resolved.index,
      query: input.query,
      limit: input.limit,
    });
    return {
      selection: structuredClone(resolved.selection),
      selectionTransitionId: resolved.selectionTransitionId,
      response,
      verificationReceiptId: resolved.verificationReceipt?.receiptId ?? null,
      productQualificationId: resolved.productQualificationId,
    };
  } catch (error) {
    throw new SearchLocalError(
      "engine_selection_unavailable",
      "The selected search engine did not produce a valid response.",
      {
        cause: error instanceof Error ? error : undefined,
      },
    );
  }
}
