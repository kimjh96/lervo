import { canonicalHash, contentId } from "./integrity.js";
import {
  SEARCH_ENGINE,
  SEARCH_MAX_RESULTS,
  searchSourceKinds,
  SearchError,
  type SearchAttempt,
  type SearchResponse,
} from "./types.js";
import { assertSearchEngineIdentity, sameSearchEngine } from "./evaluation-engine.js";
import { assertTimestamp, SHA256_PATTERN, SOURCE_ID_PATTERN } from "./validation.js";

export const SEARCH_ATTEMPT_PATTERN = /^sat_[a-f0-9]{24}$/;
const NONCE_PATTERN = /^[a-f0-9]{32}$/;
const INDEX_PATTERN = /^sidx_[a-f0-9]{24}$/;

function hitKey(hit: SearchAttempt["hits"][number]): string {
  return `${hit.sourceKind.length}:${hit.sourceKind}${hit.sourceId}`;
}

export function createSearchAttempt(input: {
  projectId: string;
  observedAt: Date;
  nonce: string;
  response: SearchResponse;
  selectionTransitionId?: string | null;
}): SearchAttempt {
  assertSearchEngineIdentity(input.response.engine, "invalid_attempt");
  const selectionTransitionId = input.selectionTransitionId ?? null;
  if (selectionTransitionId !== null && !/^seact_[a-f0-9]{24}$/.test(selectionTransitionId)) {
    throw new SearchError("invalid_attempt", "The search engine selection transition ID is invalid.");
  }
  if (!sameSearchEngine(input.response.engine, SEARCH_ENGINE) && selectionTransitionId === null) {
    throw new SearchError("invalid_attempt", "A candidate search engine attempt requires a selection transition ID.");
  }
  const core = {
    projectId: input.projectId,
    observedAt: input.observedAt.toISOString(),
    nonce: input.nonce,
    engine: { ...input.response.engine },
    selectionTransitionId,
    indexId: input.response.indexId,
    queryDigest: input.response.queryDigest,
    queryCharacterCount: input.response.queryCharacterCount,
    queryTermCount: input.response.queryTermCount,
    requestedLimit: input.response.requestedLimit,
    resultSetHash: input.response.resultSetHash,
    hits: input.response.hits.map((hit) => ({
      sourceKind: hit.source.kind,
      sourceId: hit.source.sourceId,
      contentHash: hit.source.contentHash,
      rank: hit.rank,
      score: hit.score,
    })),
  };
  const attempt: SearchAttempt = { schemaVersion: 1, attemptId: contentId("sat", core), ...core };
  assertSearchAttempt(attempt);
  return attempt;
}

export function assertSearchAttempt(attempt: SearchAttempt): void {
  if (attempt.schemaVersion !== 1 || !SEARCH_ATTEMPT_PATTERN.test(attempt.attemptId) ||
    !SOURCE_ID_PATTERN.test(attempt.projectId) || !NONCE_PATTERN.test(attempt.nonce) ||
    (attempt.selectionTransitionId !== null && !/^seact_[a-f0-9]{24}$/.test(attempt.selectionTransitionId)) ||
    !INDEX_PATTERN.test(attempt.indexId) || !SHA256_PATTERN.test(attempt.queryDigest) ||
    !SHA256_PATTERN.test(attempt.resultSetHash) ||
    !Number.isSafeInteger(attempt.queryCharacterCount) || attempt.queryCharacterCount < 1 || attempt.queryCharacterCount > 500 ||
    !Number.isSafeInteger(attempt.queryTermCount) || attempt.queryTermCount < 1 || attempt.queryTermCount > 32 ||
    !Number.isSafeInteger(attempt.requestedLimit) || attempt.requestedLimit < 1 || attempt.requestedLimit > SEARCH_MAX_RESULTS ||
    !Array.isArray(attempt.hits) || attempt.hits.length > attempt.requestedLimit) {
    throw new SearchError("invalid_attempt", "The search attempt contract is invalid.");
  }
  assertSearchEngineIdentity(attempt.engine, "invalid_attempt");
  if (!sameSearchEngine(attempt.engine, SEARCH_ENGINE) && attempt.selectionTransitionId === null) {
    throw new SearchError("invalid_attempt", "A candidate search engine attempt requires a selection transition ID.");
  }
  assertTimestamp(attempt.observedAt, "invalid_attempt");
  for (const [index, hit] of attempt.hits.entries()) {
    if (!searchSourceKinds.includes(hit.sourceKind) || !SOURCE_ID_PATTERN.test(hit.sourceId) ||
      !SHA256_PATTERN.test(hit.contentHash) || hit.rank !== index + 1 ||
      !Number.isSafeInteger(hit.score) || hit.score < 1) {
      throw new SearchError("invalid_attempt", "The search attempt result coordinates are invalid.");
    }
  }
  if (new Set(attempt.hits.map(hitKey)).size !== attempt.hits.length ||
    attempt.hits.some((hit, index) => {
      if (index === 0) return false;
      const previous = attempt.hits[index - 1]!;
      return hit.score > previous.score || (hit.score === previous.score && hitKey(hit) <= hitKey(previous));
    })) {
    throw new SearchError("invalid_attempt", "Search attempt results are duplicated or not ordered by score.");
  }
  const { schemaVersion: _schema, attemptId: _id, ...core } = attempt;
  if (canonicalHash(attempt.hits) !== attempt.resultSetHash || contentId("sat", core) !== attempt.attemptId) {
    throw new SearchError("invalid_attempt", "The search attempt hash does not match the actual results.");
  }
}
