import { assertSearchEvaluationCase } from "./evaluation-case.js";
import {
  assertOrderedEvaluationSources,
  evaluationSourceKey,
  measureSearchExpectation,
  SEARCH_EVALUATION_CASE_PATTERN,
  SEARCH_EVALUATION_RESULT_PATTERN,
} from "./evaluation-common.js";
import {
  searchEvaluationFailureReasons,
  type SearchEvaluationCase,
  type SearchEvaluationResult,
} from "./evaluation-types.js";
import { canonicalHash, contentId } from "./integrity.js";
import {
  assertSearchEngineIdentity,
  SEARCH_INDEX_ID_PATTERN,
} from "./evaluation-engine.js";
import {
  searchSourceKinds,
  SEARCH_MAX_RESULTS,
  SearchError,
  type SearchResponse,
} from "./types.js";
import { assertTimestamp, SHA256_PATTERN, SOURCE_ID_PATTERN } from "./validation.js";

function comparison(
  reference: SearchEvaluationCase["review"]["referenceStatus"],
  current: SearchEvaluationResult["status"],
): SearchEvaluationResult["comparisonToReference"] {
  if (reference === "passed" && current === "failed") return "regressed";
  if (reference === "failed" && current === "passed") return "improved";
  return "unchanged";
}

function hitKey(hit: SearchEvaluationResult["hits"][number]): string {
  return `${hit.sourceKind.length}:${hit.sourceKind}${hit.sourceId}`;
}

export function createSearchEvaluationResult(input: {
  evaluationCase: SearchEvaluationCase;
  response: SearchResponse;
  evaluatedAt: Date;
}): SearchEvaluationResult {
  assertSearchEvaluationCase(input.evaluationCase);
  if (input.response.queryDigest !== input.evaluationCase.queryDigest ||
    input.response.queryCharacterCount !== input.evaluationCase.queryCharacterCount ||
    input.response.queryTermCount !== input.evaluationCase.queryTermCount) {
    throw new SearchError("invalid_evaluation_result", "Query coordinates in the search evaluation result differ from the case.");
  }
  const measurement = measureSearchExpectation(
    input.evaluationCase.expectation,
    input.response.hits.map((hit) => ({
      sourceKind: hit.source.kind,
      sourceId: hit.source.sourceId,
      rank: hit.rank,
    })),
  );
  const core = {
    caseId: input.evaluationCase.caseId,
    projectId: input.evaluationCase.projectId,
    evaluatedAt: input.evaluatedAt.toISOString(),
    engine: input.response.engine,
    indexId: input.response.indexId,
    queryDigest: input.response.queryDigest,
    requestedLimit: input.response.requestedLimit,
    returnedHits: input.response.hits.length,
    resultSetHash: input.response.resultSetHash,
    hits: input.response.hits.map((hit) => ({
      sourceKind: hit.source.kind,
      sourceId: hit.source.sourceId,
      contentHash: hit.source.contentHash,
      rank: hit.rank,
      score: hit.score,
    })),
    status: measurement.status,
    failureReason: measurement.failureReason,
    expectedSourceRanks: measurement.expectedSourceRanks,
    comparisonToReference: comparison(input.evaluationCase.review.referenceStatus, measurement.status),
    embeddingDecision: "not_determined" as const,
  };
  const result: SearchEvaluationResult = {
    schemaVersion: 1,
    resultId: contentId("ser", core),
    ...core,
  };
  assertSearchEvaluationResult(result, input.evaluationCase);
  return result;
}

export function assertSearchEvaluationResult(
  result: SearchEvaluationResult,
  evaluationCase?: SearchEvaluationCase,
): void {
  if (result.schemaVersion !== 1 || !SEARCH_EVALUATION_RESULT_PATTERN.test(result.resultId) ||
    !SEARCH_EVALUATION_CASE_PATTERN.test(result.caseId) || !SOURCE_ID_PATTERN.test(result.projectId) ||
    !SEARCH_INDEX_ID_PATTERN.test(result.indexId) || !SHA256_PATTERN.test(result.queryDigest) ||
    !Number.isSafeInteger(result.requestedLimit) || result.requestedLimit < 1 ||
    result.requestedLimit > SEARCH_MAX_RESULTS || !Number.isSafeInteger(result.returnedHits) ||
    result.returnedHits < 0 || result.returnedHits > result.requestedLimit || !SHA256_PATTERN.test(result.resultSetHash) ||
    !["passed", "failed"].includes(result.status) ||
    (result.status === "passed"
      ? result.failureReason !== null
      : !searchEvaluationFailureReasons.includes(result.failureReason!)) ||
    (result.failureReason === "no_results" && result.returnedHits !== 0) ||
    (result.failureReason !== null && result.failureReason !== "no_results" && result.returnedHits === 0) ||
    !["improved", "unchanged", "regressed"].includes(result.comparisonToReference) ||
    result.embeddingDecision !== "not_determined" || !Array.isArray(result.expectedSourceRanks) ||
    result.expectedSourceRanks.length < 1 || result.expectedSourceRanks.length > SEARCH_MAX_RESULTS ||
    !Array.isArray(result.hits) || result.hits.length !== result.returnedHits) {
    throw new SearchError("invalid_evaluation_result", "The search evaluation result contract is invalid.");
  }
  assertSearchEngineIdentity(result.engine, "invalid_evaluation_result");
  assertTimestamp(result.evaluatedAt, "invalid_evaluation_result");
  for (const [index, hit] of result.hits.entries()) {
    if (!searchSourceKinds.includes(hit.sourceKind) || !SOURCE_ID_PATTERN.test(hit.sourceId) ||
      !SHA256_PATTERN.test(hit.contentHash) || hit.rank !== index + 1 ||
      !Number.isSafeInteger(hit.score) || hit.score < 1) {
      throw new SearchError("invalid_evaluation_result", "Hit coordinates in the search evaluation result are invalid.");
    }
  }
  if (new Set(result.hits.map(hitKey)).size !== result.hits.length ||
    result.hits.some((hit, index) => {
      if (index === 0) return false;
      const previous = result.hits[index - 1]!;
      return hit.score > previous.score || (hit.score === previous.score && hitKey(hit) <= hitKey(previous));
    }) || canonicalHash(result.hits) !== result.resultSetHash) {
    throw new SearchError("invalid_evaluation_result", "Hit order or result-set hash in the search evaluation result differs.");
  }
  assertOrderedEvaluationSources(result.expectedSourceRanks, "invalid_evaluation_result");
  const hitRanks = new Map(result.hits.map((hit) => [hitKey(hit), hit.rank]));
  const keys = result.expectedSourceRanks.map((source) => {
    if (typeof source !== "object" || source === null ||
      (source.rank !== null && (!Number.isSafeInteger(source.rank) || source.rank < 1 ||
        source.rank > result.requestedLimit))) {
      throw new SearchError("invalid_evaluation_result", "An expected source rank in the search evaluation result is invalid.");
    }
    return evaluationSourceKey(source);
  });
  if (result.expectedSourceRanks.filter((source) => source.rank !== null).length > result.returnedHits) {
    throw new SearchError("invalid_evaluation_result", "The expected source rank count exceeds the actual result count.");
  }
  if (result.expectedSourceRanks.some((source) => source.rank !== (hitRanks.get(evaluationSourceKey(source)) ?? null))) {
    throw new SearchError("invalid_evaluation_result", "Expected source ranks differ from actual hit coordinates.");
  }
  if (new Set(keys).size !== keys.length || keys.some((key, index) => index > 0 && keys[index - 1]! >= key)) {
    throw new SearchError("invalid_evaluation_result", "Expected source order in the search evaluation result is invalid.");
  }
  if (evaluationCase !== undefined) {
    assertSearchEvaluationCase(evaluationCase);
    const caseKeys = evaluationCase.expectation.sources.map(evaluationSourceKey);
    const withinRank = result.expectedSourceRanks.filter((source) =>
      source.rank !== null && source.rank <= evaluationCase.expectation.maximumRank);
    const status = evaluationCase.expectation.matchMode === "any"
      ? withinRank.length > 0 ? "passed" : "failed"
      : withinRank.length === result.expectedSourceRanks.length ? "passed" : "failed";
    const expectedComparison = comparison(evaluationCase.review.referenceStatus, status);
    if (keys.length !== caseKeys.length || result.caseId !== evaluationCase.caseId ||
      result.projectId !== evaluationCase.projectId ||
      result.queryDigest !== evaluationCase.queryDigest || keys.some((key, index) => key !== caseKeys[index]) ||
      result.status !== status || result.comparisonToReference !== expectedComparison) {
      throw new SearchError("invalid_evaluation_result", "The search evaluation result differs from its target case.");
    }
    const expectedFailure = status === "passed"
      ? null
      : result.returnedHits === 0
        ? "no_results"
        : result.expectedSourceRanks.some((source) => source.rank === null)
          ? "expected_source_missing"
          : "low_rank";
    if (result.failureReason !== expectedFailure) {
      throw new SearchError("invalid_evaluation_result", "The search evaluation result failure reason conflicts with its ranks.");
    }
  }
  const { schemaVersion: _schema, resultId: _id, ...core } = result;
  if (contentId("ser", core) !== result.resultId) {
    throw new SearchError("invalid_evaluation_result", "The search evaluation result ID does not match its content.");
  }
}
