import { contentId, canonicalHash } from "./integrity.js";
import { normalizeSearchText } from "./normalize.js";
import { SearchError } from "./types.js";
import { SHA256_PATTERN } from "./validation.js";

export const SEARCH_QUERY_PROJECTOR_ID_PATTERN = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+){0,7}$/;
export const SEARCH_QUERY_PROJECTOR_BUILD_ID_PATTERN = /^sqbuild_[a-f0-9]{24}$/;
export const SEARCH_QUERY_PROJECTION_RECEIPT_ID_PATTERN = /^sqproj_[a-f0-9]{24}$/;
export const SEARCH_QUERY_PROJECTION_MAXIMUM_QUERIES = 8;
export const SEARCH_QUERY_PROJECTION_MAXIMUM_QUERY_CHARACTERS = 500;
export const SEARCH_QUERY_PROJECTION_MAXIMUM_QUERY_TERMS = 32;

export interface SearchQueryProjectorIdentity {
  id: string;
  version: number;
  buildId: string;
}

export type SearchQueryProjectionStatus = "completed" | "empty" | "failed";

export interface SearchQueryProjectionUsage {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
  totalTokens: number;
  contextWindow: number | null;
}

export interface SearchQueryProjectionReceipt {
  schemaVersion: 1;
  receiptId: string;
  stageId: "query_projection";
  projector: SearchQueryProjectorIdentity;
  requestDigest: string;
  contextDigest: string;
  projectorResultDigest: string;
  requestedLanguage: string;
  limits: {
    maximumQueries: number;
    maximumQueryCharacters: number;
  };
  projectedQueryCount: number;
  projectedQueryDigest: string;
  durationMs: number;
  status: SearchQueryProjectionStatus;
  usage?: SearchQueryProjectionUsage;
  privacy: {
    requestText: "excluded";
    contextText: "excluded";
    projectedQueryText: "excluded";
  };
}

export interface SearchQueryProjection {
  queries: readonly string[];
  receipt: SearchQueryProjectionReceipt;
}

export interface SearchQueryProjectionRequest {
  request: string;
  requestDigest: string;
  context: unknown;
  contextDigest: string;
  contextAnchors?: readonly string[];
  requestedLanguage: string;
  limits?: {
    maximumQueries: number;
    maximumQueryCharacters: number;
  };
  signal?: AbortSignal;
}

/** Provider-neutral boundary for turning untrusted language into retrieval-only queries. */
export interface SearchQueryProjectorPort {
  readonly projector: SearchQueryProjectorIdentity;
  project(input: SearchQueryProjectionRequest): Promise<SearchQueryProjection>;
}

function assertProjector(projector: SearchQueryProjectorIdentity): void {
  if (
    !SEARCH_QUERY_PROJECTOR_ID_PATTERN.test(projector.id) ||
    projector.id.length > 64 ||
    !Number.isSafeInteger(projector.version) ||
    projector.version < 1 ||
    projector.version > 1_000_000 ||
    !SEARCH_QUERY_PROJECTOR_BUILD_ID_PATTERN.test(projector.buildId)
  ) {
    throw new SearchError(
      "invalid_query_projection",
      "The search query projector coordinates are invalid.",
    );
  }
}

function assertLanguage(language: string): void {
  if (!/^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8}){0,3}$/.test(language)) {
    throw new SearchError(
      "invalid_query_projection",
      "The search query projection language is invalid.",
    );
  }
}

function assertProjectionLimits(limits: {
  maximumQueries: number;
  maximumQueryCharacters: number;
}): void {
  if (
    !Number.isSafeInteger(limits.maximumQueries) ||
    limits.maximumQueries < 1 ||
    limits.maximumQueries > SEARCH_QUERY_PROJECTION_MAXIMUM_QUERIES ||
    !Number.isSafeInteger(limits.maximumQueryCharacters) ||
    limits.maximumQueryCharacters < 1 ||
    limits.maximumQueryCharacters > SEARCH_QUERY_PROJECTION_MAXIMUM_QUERY_CHARACTERS
  ) {
    throw new SearchError(
      "invalid_query_projection",
      "The search query projection limits are invalid.",
    );
  }
}

function assertQueries(
  queries: readonly string[],
  limits: { maximumQueries: number; maximumQueryCharacters: number },
): void {
  if (
    queries.length > limits.maximumQueries ||
    new Set(queries).size !== queries.length ||
    queries.some(
      (query) =>
        query.trim() !== query ||
        query.length === 0 ||
        query.length > limits.maximumQueryCharacters ||
        (normalizeSearchText(query).match(/[\p{L}\p{N}]+/gu) ?? []).length >
          SEARCH_QUERY_PROJECTION_MAXIMUM_QUERY_TERMS,
    )
  ) {
    throw new SearchError(
      "invalid_query_projection",
      "The projected search queries violate their bounds.",
    );
  }
}

export function boundProjectedSearchQuery(
  value: string,
  maximumQueryCharacters = SEARCH_QUERY_PROJECTION_MAXIMUM_QUERY_CHARACTERS,
): string {
  assertProjectionLimits({
    maximumQueries: SEARCH_QUERY_PROJECTION_MAXIMUM_QUERIES,
    maximumQueryCharacters,
  });
  const terms = normalizeSearchText(value).match(/[\p{L}\p{N}]+/gu) ?? [];
  if (terms.length === 0) {
    throw new SearchError(
      "invalid_query_projection",
      "A projected search query contains no searchable term.",
    );
  }
  const selected: string[] = [];
  for (const term of terms.slice(0, SEARCH_QUERY_PROJECTION_MAXIMUM_QUERY_TERMS)) {
    const candidate = [...selected, term].join(" ");
    if (candidate.length <= maximumQueryCharacters) {
      selected.push(term);
      continue;
    }
    if (selected.length === 0) {
      selected.push(term.slice(0, maximumQueryCharacters));
    }
    break;
  }
  return selected.join(" ");
}

export function boundProjectedSearchQueries(
  values: readonly string[],
  limits: {
    maximumQueries: number;
    maximumQueryCharacters: number;
  } = {
    maximumQueries: SEARCH_QUERY_PROJECTION_MAXIMUM_QUERIES,
    maximumQueryCharacters: SEARCH_QUERY_PROJECTION_MAXIMUM_QUERY_CHARACTERS,
  },
): string[] {
  assertProjectionLimits(limits);
  const bounded = values
    .slice(0, limits.maximumQueries)
    .map((value) => boundProjectedSearchQuery(value, limits.maximumQueryCharacters));
  return [...new Set(bounded)];
}

function projectionCore(input: {
  projector: SearchQueryProjectorIdentity;
  requestDigest: string;
  contextDigest: string;
  projectorResultDigest: string;
  requestedLanguage: string;
  queries: readonly string[];
  durationMs: number;
  status: SearchQueryProjectionStatus;
  limits: { maximumQueries: number; maximumQueryCharacters: number };
  usage?: SearchQueryProjectionUsage;
}) {
  return {
    stageId: "query_projection" as const,
    projector: { ...input.projector },
    requestDigest: input.requestDigest,
    contextDigest: input.contextDigest,
    projectorResultDigest: input.projectorResultDigest,
    requestedLanguage: input.requestedLanguage,
    limits: { ...input.limits },
    projectedQueryCount: input.queries.length,
    projectedQueryDigest: canonicalHash(input.queries),
    durationMs: input.durationMs,
    status: input.status,
    ...(input.usage === undefined ? {} : { usage: { ...input.usage } }),
    privacy: {
      requestText: "excluded" as const,
      contextText: "excluded" as const,
      projectedQueryText: "excluded" as const,
    },
  };
}

export function createSearchQueryProjection(input: {
  projector: SearchQueryProjectorIdentity;
  requestDigest: string;
  contextDigest: string;
  projectorResultDigest: string;
  requestedLanguage: string;
  queries: readonly string[];
  durationMs: number;
  status: SearchQueryProjectionStatus;
  limits?: { maximumQueries: number; maximumQueryCharacters: number };
  usage?: SearchQueryProjectionUsage;
}): SearchQueryProjection {
  const limits = input.limits ?? {
    maximumQueries: SEARCH_QUERY_PROJECTION_MAXIMUM_QUERIES,
    maximumQueryCharacters: SEARCH_QUERY_PROJECTION_MAXIMUM_QUERY_CHARACTERS,
  };
  assertProjector(input.projector);
  assertLanguage(input.requestedLanguage);
  assertProjectionLimits(limits);
  assertQueries(input.queries, limits);
  if (
    !SHA256_PATTERN.test(input.requestDigest) ||
    !SHA256_PATTERN.test(input.contextDigest) ||
    !SHA256_PATTERN.test(input.projectorResultDigest) ||
    !Number.isSafeInteger(input.durationMs) ||
    input.durationMs < 0 ||
    input.durationMs > 600_000 ||
    (input.status === "completed" && input.queries.length === 0) ||
    (input.status !== "completed" && input.queries.length !== 0)
  ) {
    throw new SearchError(
      "invalid_query_projection",
      "The search query projection input is invalid.",
    );
  }
  const queries = [...input.queries];
  const core = projectionCore({ ...input, queries, limits });
  const receipt: SearchQueryProjectionReceipt = {
    schemaVersion: 1,
    receiptId: contentId("sqproj", core),
    ...core,
  };
  assertSearchQueryProjectionReceipt(receipt);
  return { queries, receipt };
}

export function assertSearchQueryProjectionReceipt(receipt: SearchQueryProjectionReceipt): void {
  assertProjector(receipt.projector);
  assertLanguage(receipt.requestedLanguage);
  assertProjectionLimits(receipt.limits);
  const usage = receipt.usage;
  if (
    receipt.schemaVersion !== 1 ||
    !SEARCH_QUERY_PROJECTION_RECEIPT_ID_PATTERN.test(receipt.receiptId) ||
    receipt.stageId !== "query_projection" ||
    !SHA256_PATTERN.test(receipt.requestDigest) ||
    !SHA256_PATTERN.test(receipt.contextDigest) ||
    !SHA256_PATTERN.test(receipt.projectorResultDigest) ||
    !Number.isSafeInteger(receipt.projectedQueryCount) ||
    receipt.projectedQueryCount < 0 ||
    receipt.projectedQueryCount > receipt.limits.maximumQueries ||
    !SHA256_PATTERN.test(receipt.projectedQueryDigest) ||
    !Number.isSafeInteger(receipt.durationMs) ||
    receipt.durationMs < 0 ||
    receipt.durationMs > 600_000 ||
    (receipt.status === "completed" && receipt.projectedQueryCount === 0) ||
    (receipt.status !== "completed" && receipt.projectedQueryCount !== 0) ||
    receipt.privacy.requestText !== "excluded" ||
    receipt.privacy.contextText !== "excluded" ||
    receipt.privacy.projectedQueryText !== "excluded" ||
    (usage !== undefined &&
      (!Number.isSafeInteger(usage.inputTokens) ||
        usage.inputTokens < 0 ||
        !Number.isSafeInteger(usage.cachedInputTokens) ||
        usage.cachedInputTokens < 0 ||
        usage.cachedInputTokens > usage.inputTokens ||
        !Number.isSafeInteger(usage.outputTokens) ||
        usage.outputTokens < 0 ||
        !Number.isSafeInteger(usage.reasoningOutputTokens) ||
        usage.reasoningOutputTokens < 0 ||
        !Number.isSafeInteger(usage.totalTokens) ||
        usage.totalTokens !== usage.inputTokens + usage.outputTokens ||
        (usage.contextWindow !== null &&
          (!Number.isSafeInteger(usage.contextWindow) || usage.contextWindow < 1))))
  ) {
    throw new SearchError(
      "invalid_query_projection",
      "The search query projection receipt contract is invalid.",
    );
  }
  const { schemaVersion: _schemaVersion, receiptId: _receiptId, ...core } = receipt;
  if (contentId("sqproj", core) !== receipt.receiptId) {
    throw new SearchError(
      "invalid_query_projection",
      "The search query projection receipt ID does not match its content.",
    );
  }
}

export function searchQueryProjectorBuildId(contract: string): string {
  if (contract.trim() !== contract || contract.length === 0 || contract.length > 1_024) {
    throw new SearchError(
      "invalid_query_projection",
      "The search query projector build contract is invalid.",
    );
  }
  return contentId("sqbuild", contract);
}
