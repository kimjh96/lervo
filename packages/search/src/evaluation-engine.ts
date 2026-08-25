import type { SearchEngineIdentity, SearchResponse, SearchSourceInput } from "./types.js";
import { SearchError, type SearchErrorCode } from "./types.js";

export const SEARCH_ENGINE_ID_PATTERN = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+){0,7}$/;
export const SEARCH_INDEX_ID_PATTERN = /^sidx_[a-f0-9]{24}$/;
export const SEARCH_ADAPTER_BUILD_ID_PATTERN = /^sebuild_[a-f0-9]{24}$/;

export interface SearchIndexPort {
  readonly engine: SearchEngineIdentity;
  readonly indexId: string;
  search(query: string, limit: number): SearchResponse | Promise<SearchResponse>;
}

export interface SearchEnginePort {
  readonly engine: SearchEngineIdentity;
  readonly adapterBuildId: string;
  buildIndex(sources: readonly SearchSourceInput[]): SearchIndexPort | Promise<SearchIndexPort>;
}

export type SearchEvaluationIndexPort = SearchIndexPort;
export type SearchEvaluationEnginePort = SearchEnginePort;

export function assertSearchEngineIdentity(
  engine: SearchEngineIdentity,
  errorCode: SearchErrorCode = "invalid_evaluation_engine",
): void {
  if (
    typeof engine !== "object" ||
    engine === null ||
    !SEARCH_ENGINE_ID_PATTERN.test(engine.id) ||
    engine.id.length > 64 ||
    !Number.isSafeInteger(engine.version) ||
    engine.version < 1 ||
    engine.version > 1_000_000
  ) {
    throw new SearchError(errorCode, "The search evaluation engine coordinates are invalid.");
  }
}

export function sameSearchEngine(left: SearchEngineIdentity, right: SearchEngineIdentity): boolean {
  return left.id === right.id && left.version === right.version;
}

export function assertSearchAdapterBuildId(
  adapterBuildId: string,
  errorCode: SearchErrorCode = "invalid_evaluation_engine",
): void {
  if (!SEARCH_ADAPTER_BUILD_ID_PATTERN.test(adapterBuildId)) {
    throw new SearchError(errorCode, "The search adapter build ID is invalid.");
  }
}
