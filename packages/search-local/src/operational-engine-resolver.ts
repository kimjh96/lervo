import {
  assertProductDefaultSearchEngine,
  assertSearchResponse,
  baselineSearchEngineSelection,
  identifySearchQuery,
  LexicalSearchIndex,
  SEARCH_MAX_RESULTS,
  SearchError,
  sameSearchEngine,
  type BaselineSearchEngineSelection,
  type SearchCandidateEngineResolver,
  type ProductDefaultSearchEngine,
  type ProductDefaultSearchEngineSelection,
  type SearchIndexPort,
  type SearchResponse,
} from "@lervo/search";

import { loadRegisteredDocumentCorpus } from "./corpus.js";
import { SearchLocalError } from "./types.js";

export interface ResolvedOperationalSearchEngine {
  selection: OperationalSearchEngineSelection;
  index: SearchIndexPort;
  productQualificationId: string | null;
}

export type OperationalSearchEngineSelection =
  BaselineSearchEngineSelection | ProductDefaultSearchEngineSelection;

export interface OperationalSearchResult {
  selection: OperationalSearchEngineSelection;
  /** Always null: engine selection transitions were removed by ADR-0560. */
  selectionTransitionId: null;
  response: SearchResponse;
  productQualificationId: string | null;
}

export interface OperationalSearchEngineInspection {
  selection: OperationalSearchEngineSelection;
  resolverState: "ready" | "unavailable";
  failureCode: string | null;
  productQualificationId: string | null;
}

function productDefaultSelection(
  productDefault: ProductDefaultSearchEngine,
): ProductDefaultSearchEngineSelection {
  return {
    mode: "product_default",
    qualificationId: productDefault.qualificationId,
    candidateId: productDefault.candidateId,
    engine: { ...productDefault.engine },
    reviewId: null,
    comparisonId: null,
  };
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
      selection: productDefaultSelection(input.productDefault),
      index: await engine.buildIndex(await loadRegisteredDocumentCorpus(input.repositoryRoot)),
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

/** Resolves the product default engine, or the built-in lexical engine when none is supplied. */
export async function resolveOperationalSearchEngine(input: {
  repositoryRoot: string;
  projectId: string;
  registry: SearchCandidateEngineResolver;
  productDefault?: ProductDefaultSearchEngine;
}): Promise<ResolvedOperationalSearchEngine> {
  if (input.productDefault !== undefined) {
    return resolveProductDefaultSearchEngine({
      repositoryRoot: input.repositoryRoot,
      registry: input.registry,
      productDefault: input.productDefault,
    });
  }
  return {
    selection: baselineSearchEngineSelection(),
    index: new LexicalSearchIndex(await loadRegisteredDocumentCorpus(input.repositoryRoot)),
    productQualificationId: null,
  };
}

export async function inspectOperationalSearchEngine(input: {
  repositoryRoot: string;
  projectId: string;
  registry: SearchCandidateEngineResolver;
  productDefault?: ProductDefaultSearchEngine;
}): Promise<OperationalSearchEngineInspection> {
  const selection: OperationalSearchEngineSelection =
    input.productDefault === undefined
      ? baselineSearchEngineSelection()
      : productDefaultSelection(input.productDefault);
  try {
    const resolved = await resolveOperationalSearchEngine(input);
    return {
      selection,
      resolverState: "ready",
      failureCode: null,
      productQualificationId: resolved.productQualificationId,
    };
  } catch (error) {
    return {
      selection,
      resolverState: "unavailable",
      failureCode:
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        typeof error.code === "string"
          ? error.code
          : "engine_selection_unavailable",
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
      selectionTransitionId: null,
      response,
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
