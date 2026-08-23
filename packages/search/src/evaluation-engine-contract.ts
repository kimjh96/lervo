import { searchSourceKey } from "./corpus.js";
import {
  assertSearchAdapterBuildId,
  assertSearchEngineIdentity,
  SEARCH_INDEX_ID_PATTERN,
  sameSearchEngine,
  type SearchEvaluationEnginePort,
  type SearchIndexPort,
} from "./evaluation-engine.js";
import { canonicalHash } from "./integrity.js";
import { identifySearchQuery } from "./normalize.js";
import {
  SEARCH_MAX_RESULTS,
  SearchError,
  type SearchHit,
  type SearchResponse,
  type SearchSourceInput,
} from "./types.js";
import { assertSourceReference } from "./validation.js";

const MATCHED_FIELDS: SearchHit["matchedFields"] = ["label", "path", "text", "title"];

function hitKey(hit: SearchHit): string {
  return searchSourceKey(hit.source);
}

export function assertSearchResponse(input: {
  response: SearchResponse;
  index: Pick<SearchIndexPort, "engine" | "indexId">;
  query: string;
  limit: number;
}): void {
  const { response, index } = input;
  assertSearchEngineIdentity(index.engine);
  const queryIdentity = identifySearchQuery(input.query);
  if (response.schemaVersion !== 1 || !sameSearchEngine(response.engine, index.engine) ||
    !SEARCH_INDEX_ID_PATTERN.test(index.indexId) || response.indexId !== index.indexId ||
    response.queryDigest !== queryIdentity.queryDigest ||
    response.queryCharacterCount !== queryIdentity.queryCharacterCount ||
    response.queryTermCount !== queryIdentity.queryTermCount || response.requestedLimit !== input.limit ||
    !Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > SEARCH_MAX_RESULTS ||
    !Array.isArray(response.hits) || response.hits.length > input.limit) {
    throw new SearchError("invalid_evaluation_engine", "The search evaluation response has invalid engine, index, query, or limit coordinates.");
  }
  for (const [indexPosition, hit] of response.hits.entries()) {
    try {
      assertSourceReference(hit.source);
    } catch (error) {
      throw new SearchError("invalid_evaluation_engine", "The search evaluation response source coordinates are invalid.", {
        cause: error instanceof Error ? error : undefined,
      });
    }
    if (hit.rank !== indexPosition + 1 || !Number.isSafeInteger(hit.score) || hit.score < 1 ||
      !Array.isArray(hit.matchedFields) || hit.matchedFields.length < 1 || hit.matchedFields.length > 4 ||
      hit.matchedFields.some((field) => !MATCHED_FIELDS.includes(field)) ||
      new Set(hit.matchedFields).size !== hit.matchedFields.length ||
      hit.matchedFields.some((field, fieldIndex) => fieldIndex > 0 && hit.matchedFields[fieldIndex - 1]! >= field)) {
      throw new SearchError("invalid_evaluation_engine", "The search evaluation response hit contract is invalid.");
    }
  }
  if (new Set(response.hits.map(hitKey)).size !== response.hits.length ||
    response.hits.some((hit, indexPosition) => {
      if (indexPosition === 0) return false;
      const previous = response.hits[indexPosition - 1]!;
      return hit.score > previous.score || (hit.score === previous.score && hitKey(hit) <= hitKey(previous));
    })) {
    throw new SearchError("invalid_evaluation_engine", "Search evaluation response hits are duplicated or out of order.");
  }
  const resultCore = response.hits.map((hit) => ({
    sourceKind: hit.source.kind,
    sourceId: hit.source.sourceId,
    contentHash: hit.source.contentHash,
    rank: hit.rank,
    score: hit.score,
  }));
  if (canonicalHash(resultCore) !== response.resultSetHash) {
    throw new SearchError("invalid_evaluation_engine", "The search evaluation response result-set hash does not match its hits.");
  }
}

export const assertSearchEvaluationResponse = assertSearchResponse;

export interface SearchEvaluationEngineContractReport {
  engine: { id: string; version: number };
  adapterBuildId: string;
  indexId: string;
  checkedQueries: number;
  queryDigests: string[];
}

export async function verifySearchEvaluationEngineContract(input: {
  engine: SearchEvaluationEnginePort;
  sources: readonly SearchSourceInput[];
  queries: readonly string[];
}): Promise<SearchEvaluationEngineContractReport> {
  assertSearchEngineIdentity(input.engine.engine);
  assertSearchAdapterBuildId(input.engine.adapterBuildId);
  if (!Array.isArray(input.queries) || input.queries.length < 1 || input.queries.length > 8) {
    throw new SearchError("invalid_evaluation_engine", "The search evaluation engine contract query count is invalid.");
  }
  const sourceHash = canonicalHash(input.sources);
  const first = await input.engine.buildIndex(structuredClone(input.sources));
  const second = await input.engine.buildIndex(structuredClone([...input.sources].reverse()));
  if (canonicalHash(input.sources) !== sourceHash || !sameSearchEngine(first.engine, input.engine.engine) ||
    !sameSearchEngine(second.engine, input.engine.engine) || !SEARCH_INDEX_ID_PATTERN.test(first.indexId) ||
    first.indexId !== second.indexId) {
    throw new SearchError("invalid_evaluation_engine", "The search evaluation engine violated input immutability, coordinate, or reproducibility requirements.");
  }
  const queryDigests: string[] = [];
  for (const query of input.queries) {
    const firstResponse = await first.search(query, SEARCH_MAX_RESULTS);
    const repeatedResponse = await second.search(query, SEARCH_MAX_RESULTS);
    assertSearchEvaluationResponse({ response: firstResponse, index: first, query, limit: SEARCH_MAX_RESULTS });
    assertSearchEvaluationResponse({ response: repeatedResponse, index: second, query, limit: SEARCH_MAX_RESULTS });
    if (canonicalHash(firstResponse) !== canonicalHash(repeatedResponse)) {
      throw new SearchError("invalid_evaluation_engine", "The search evaluation engine response is not reproducible for identical input.");
    }
    queryDigests.push(firstResponse.queryDigest);
  }
  return {
    engine: { ...input.engine.engine },
    adapterBuildId: input.engine.adapterBuildId,
    indexId: first.indexId,
    checkedQueries: input.queries.length,
    queryDigests,
  };
}
