import { canonicalHash } from "./integrity.js";
import { SearchError } from "./types.js";

export const SEARCH_RRF_CONSTANT = 60;
const SEARCH_RRF_SCALE = 1_000_000;

export interface RankedFusionItem<T> {
  key: string;
  value: T;
}

export interface RankFusionResult<T> {
  schemaVersion: 1;
  algorithm: "reciprocal_rank_fusion";
  algorithmVersion: 1;
  rankConstant: number;
  inputCount: number;
  resultDigest: string;
  values: T[];
}

export interface RankInterleaveResult<T> {
  schemaVersion: 1;
  algorithm: "query_coverage_interleave";
  algorithmVersion: 1;
  inputCount: number;
  resultDigest: string;
  values: T[];
}

function assertRankedInputs<T>(
  rankedInputs: readonly (readonly RankedFusionItem<T>[])[],
  limit: number,
): void {
  if (
    rankedInputs.length < 1 ||
    rankedInputs.length > 8 ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 50
  ) {
    throw new SearchError("invalid_query_projection", "The rank-fusion bounds are invalid.");
  }
  for (const input of rankedInputs) {
    if (input.length > 50 || new Set(input.map((item) => item.key)).size !== input.length) {
      throw new SearchError(
        "invalid_query_projection",
        "A rank-fusion input violates its bounds or contains duplicate coordinates.",
      );
    }
    if (input.some((item) => !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,511}$/.test(item.key))) {
      throw new SearchError("invalid_query_projection", "A rank-fusion coordinate is invalid.");
    }
  }
}

/** Deterministic equal-weight RRF. Native engine scores never cross this boundary. */
export function reciprocalRankFusion<T>(
  rankedInputs: readonly (readonly RankedFusionItem<T>[])[],
  limit: number,
): RankFusionResult<T> {
  assertRankedInputs(rankedInputs, limit);
  const accumulated = new Map<
    string,
    { value: T; score: number; bestRank: number; firstInput: number }
  >();
  rankedInputs.forEach((input, inputIndex) => {
    input.forEach((item, rankIndex) => {
      const rank = rankIndex + 1;
      const existing = accumulated.get(item.key);
      const score = Math.floor(SEARCH_RRF_SCALE / (SEARCH_RRF_CONSTANT + rank));
      if (existing === undefined) {
        accumulated.set(item.key, {
          value: item.value,
          score,
          bestRank: rank,
          firstInput: inputIndex,
        });
      } else {
        existing.score += score;
        existing.bestRank = Math.min(existing.bestRank, rank);
        existing.firstInput = Math.min(existing.firstInput, inputIndex);
      }
    });
  });
  const ranked = [...accumulated.entries()].sort(
    ([leftKey, left], [rightKey, right]) =>
      right.score - left.score ||
      left.bestRank - right.bestRank ||
      left.firstInput - right.firstInput ||
      leftKey.localeCompare(rightKey),
  );
  const selected = ranked.slice(0, limit);
  return {
    schemaVersion: 1,
    algorithm: "reciprocal_rank_fusion",
    algorithmVersion: 1,
    rankConstant: SEARCH_RRF_CONSTANT,
    inputCount: rankedInputs.length,
    resultDigest: canonicalHash(
      selected.map(([key, value]) => ({
        key,
        score: value.score,
        bestRank: value.bestRank,
        firstInput: value.firstInput,
      })),
    ),
    values: selected.map(([, value]) => value.value),
  };
}

/** Preserves one result per semantic subquery before taking each next rank. */
export function queryCoverageInterleave<T>(
  rankedInputs: readonly (readonly RankedFusionItem<T>[])[],
  limit: number,
): RankInterleaveResult<T> {
  assertRankedInputs(rankedInputs, limit);
  const seen = new Set<string>();
  const selected: Array<{ key: string; value: T; inputIndex: number; sourceRank: number }> = [];
  const maximumInputLength = Math.max(...rankedInputs.map((input) => input.length));
  for (
    let rankIndex = 0;
    rankIndex < maximumInputLength && selected.length < limit;
    rankIndex += 1
  ) {
    for (const [inputIndex, input] of rankedInputs.entries()) {
      const item = input[rankIndex];
      if (item === undefined || seen.has(item.key)) continue;
      seen.add(item.key);
      selected.push({ key: item.key, value: item.value, inputIndex, sourceRank: rankIndex + 1 });
      if (selected.length >= limit) break;
    }
  }
  return {
    schemaVersion: 1,
    algorithm: "query_coverage_interleave",
    algorithmVersion: 1,
    inputCount: rankedInputs.length,
    resultDigest: canonicalHash(
      selected.map((item, index) => ({
        key: item.key,
        inputIndex: item.inputIndex,
        sourceRank: item.sourceRank,
        outputRank: index + 1,
      })),
    ),
    values: selected.map((item) => item.value),
  };
}
