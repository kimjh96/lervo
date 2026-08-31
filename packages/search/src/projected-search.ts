import { searchSourceKey } from "./corpus.js";
import { assertSearchResponse } from "./evaluation-engine-contract.js";
import type { SearchIndexPort } from "./evaluation-engine.js";
import { canonicalHash } from "./integrity.js";
import {
  assertSearchQueryProjectionReceipt,
  type SearchQueryProjection,
} from "./query-projection.js";
import { queryCoverageInterleave, reciprocalRankFusion } from "./rank-fusion.js";
import { SEARCH_MAX_RESULTS, SearchError, type SearchSourceReference } from "./types.js";

export interface ProjectedSearchHit {
  source: SearchSourceReference;
  rank: number;
  fusionScore: number;
  matchedQueryCount: number;
  bestSourceRank: number;
}

export interface ProjectedSearchExecution {
  schemaVersion: 1;
  projectionReceiptId: string;
  engine: { id: string; version: number };
  indexId: string;
  queryCount: number;
  perQueryLimit: number;
  finalLimit: number;
  responseDigests: string[];
  fusion: {
    algorithm: "reciprocal_rank_fusion" | "query_coverage_interleave";
    version: 1;
    rankConstant: number | null;
    resultDigest: string;
  };
  hits: ProjectedSearchHit[];
  resultSetHash: string;
}

/** Runs every projected query independently and fuses only validated source coordinates. */
export async function executeProjectedSearch(input: {
  projection: SearchQueryProjection;
  index: SearchIndexPort;
  perQueryLimit?: number;
  finalLimit?: number;
  fusionPolicy?: "reciprocal_rank_fusion" | "query_coverage_interleave";
}): Promise<ProjectedSearchExecution> {
  assertSearchQueryProjectionReceipt(input.projection.receipt);
  if (
    input.projection.receipt.status !== "completed" ||
    input.projection.queries.length !== input.projection.receipt.projectedQueryCount ||
    canonicalHash(input.projection.queries) !== input.projection.receipt.projectedQueryDigest
  ) {
    throw new SearchError(
      "invalid_query_projection",
      "The projected search execution input differs from its receipt.",
    );
  }
  const perQueryLimit = input.perQueryLimit ?? SEARCH_MAX_RESULTS;
  const finalLimit = input.finalLimit ?? 10;
  if (
    !Number.isSafeInteger(perQueryLimit) ||
    perQueryLimit < 1 ||
    perQueryLimit > SEARCH_MAX_RESULTS ||
    !Number.isSafeInteger(finalLimit) ||
    finalLimit < 1 ||
    finalLimit > SEARCH_MAX_RESULTS
  ) {
    throw new SearchError(
      "invalid_query_projection",
      "The projected search execution limits are invalid.",
    );
  }
  const responses = await Promise.all(
    input.projection.queries.map(async (query) => {
      const response = await input.index.search(query, perQueryLimit);
      assertSearchResponse({ response, index: input.index, query, limit: perQueryLimit });
      return response;
    }),
  );
  const sourceCoordinates = new Map<string, string>();
  const accumulated = new Map<string, { count: number; bestRank: number; fusionScore: number }>();
  for (const response of responses) {
    for (const hit of response.hits) {
      const key = searchSourceKey(hit.source);
      const coordinate = canonicalHash(hit.source);
      const existingCoordinate = sourceCoordinates.get(key);
      if (existingCoordinate !== undefined && existingCoordinate !== coordinate) {
        throw new SearchError(
          "invalid_query_projection",
          "A projected search source changed between retrieval stages.",
        );
      }
      sourceCoordinates.set(key, coordinate);
      const accumulatedHit = accumulated.get(key) ?? {
        count: 0,
        bestRank: Number.MAX_SAFE_INTEGER,
        fusionScore: 0,
      };
      accumulatedHit.count += 1;
      accumulatedHit.bestRank = Math.min(accumulatedHit.bestRank, hit.rank);
      accumulatedHit.fusionScore += Math.floor(1_000_000 / (60 + hit.rank));
      accumulated.set(key, accumulatedHit);
    }
  }
  const rankedInputs = responses.map((response) =>
    response.hits.map((hit) => ({ key: searchSourceKey(hit.source), value: hit.source })),
  );
  const fusionPolicy = input.fusionPolicy ?? "reciprocal_rank_fusion";
  const fused =
    fusionPolicy === "query_coverage_interleave"
      ? queryCoverageInterleave(rankedInputs, finalLimit)
      : reciprocalRankFusion(rankedInputs, finalLimit);
  const hits = fused.values.map((source, index) => {
    const score = accumulated.get(searchSourceKey(source))!;
    return {
      source: { ...source },
      rank: index + 1,
      fusionScore: score.fusionScore,
      matchedQueryCount: score.count,
      bestSourceRank: score.bestRank,
    };
  });
  return {
    schemaVersion: 1,
    projectionReceiptId: input.projection.receipt.receiptId,
    engine: { ...input.index.engine },
    indexId: input.index.indexId,
    queryCount: input.projection.queries.length,
    perQueryLimit,
    finalLimit,
    responseDigests: responses.map((response) => response.resultSetHash),
    fusion: {
      algorithm: fused.algorithm,
      version: fused.algorithmVersion,
      rankConstant: "rankConstant" in fused ? fused.rankConstant : null,
      resultDigest: fused.resultDigest,
    },
    hits,
    resultSetHash: canonicalHash(
      hits.map((hit) => ({
        source: hit.source,
        rank: hit.rank,
        fusionScore: hit.fusionScore,
        matchedQueryCount: hit.matchedQueryCount,
        bestSourceRank: hit.bestSourceRank,
      })),
    ),
  };
}
