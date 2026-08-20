import type { SearchEngineIdentity, SearchResponse, SearchSourceInput } from "./types.js";
import { SearchError, type SearchErrorCode } from "./types.js";

export const SEARCH_ENGINE_ID_PATTERN = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+){0,7}$/;
export const SEARCH_INDEX_ID_PATTERN = /^sidx_[a-f0-9]{24}$/;

export interface SearchEvaluationIndexPort {
  readonly engine: SearchEngineIdentity;
  readonly indexId: string;
  search(query: string, limit: number): SearchResponse | Promise<SearchResponse>;
}

export interface SearchEvaluationEnginePort {
  readonly engine: SearchEngineIdentity;
  buildIndex(sources: readonly SearchSourceInput[]): SearchEvaluationIndexPort | Promise<SearchEvaluationIndexPort>;
}

export function assertSearchEngineIdentity(
  engine: SearchEngineIdentity,
  errorCode: SearchErrorCode = "invalid_evaluation_engine",
): void {
  if (typeof engine !== "object" || engine === null || !SEARCH_ENGINE_ID_PATTERN.test(engine.id) ||
    engine.id.length > 64 || !Number.isSafeInteger(engine.version) || engine.version < 1 || engine.version > 1_000_000) {
    throw new SearchError(errorCode, "검색 평가 엔진 좌표가 유효하지 않습니다.");
  }
}

export function sameSearchEngine(left: SearchEngineIdentity, right: SearchEngineIdentity): boolean {
  return left.id === right.id && left.version === right.version;
}
