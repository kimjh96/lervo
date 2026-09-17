import { createHash } from "node:crypto";

import { canonicalJson } from "@lervo/event-contract";
import type { ProductUnifiedSearchResultV1 } from "@lervo/schemas";

const sha256Pattern = /^sha256:[a-f0-9]{64}$/u;
const coordinatePattern = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/u;
const adapterIdPattern = /^[a-z][a-z0-9_-]*(\/[a-z][a-z0-9_-]*)?$/u;

interface RepositoryKnowledgeSearchHit {
  conceptId: string;
  title: string;
  contentHash: string;
}

interface RepositoryKnowledgeSearchSource {
  sourceSnapshotId: string;
  impactReportId: string;
  ranking?: {
    engine: { id: string; version: number };
    adapterBuildId: string;
  };
  hits: readonly RepositoryKnowledgeSearchHit[];
}

export interface RepositoryKnowledgeSearchProjectionInputV1 {
  query: string;
  authorizationCoordinate: string;
  repositoryRevision: string;
  adapterId: string;
  result: RepositoryKnowledgeSearchSource;
  limit: number;
}

function digest(value: unknown): string {
  return `sha256:${createHash("sha256").update(canonicalJson(value)).digest("hex")}`;
}

function validateInput(input: RepositoryKnowledgeSearchProjectionInputV1): void {
  if (input.query.trim() === "") throw new TypeError("Product search query must not be empty.");
  if (!coordinatePattern.test(input.authorizationCoordinate)) {
    throw new TypeError("Product search authorization coordinate is invalid.");
  }
  if (!sha256Pattern.test(input.repositoryRevision)) {
    throw new TypeError("Product search repository revision is invalid.");
  }
  if (!adapterIdPattern.test(input.adapterId)) {
    throw new TypeError("Product search adapter ID is invalid.");
  }
  if (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 100) {
    throw new RangeError("Product search limit must be a safe integer between 1 and 100.");
  }
  if (input.result.ranking === undefined) {
    throw new TypeError("Product search requires an observed ranking engine coordinate.");
  }
  const { engine, adapterBuildId } = input.result.ranking;
  if (
    !coordinatePattern.test(engine.id) ||
    !Number.isSafeInteger(engine.version) ||
    engine.version < 1 ||
    !coordinatePattern.test(adapterBuildId) ||
    !coordinatePattern.test(input.result.sourceSnapshotId) ||
    !coordinatePattern.test(input.result.impactReportId)
  ) {
    throw new TypeError("Product search source coordinates are invalid.");
  }
  if (input.result.hits.length > input.limit) {
    throw new RangeError("Product search source returned more hits than the requested limit.");
  }
  const concepts = new Set<string>();
  for (const hit of input.result.hits) {
    if (
      !coordinatePattern.test(hit.conceptId) ||
      !sha256Pattern.test(hit.contentHash) ||
      hit.title.length < 1 ||
      hit.title.length > 200 ||
      concepts.has(hit.conceptId)
    ) {
      throw new TypeError("Product search source returned an invalid or duplicate hit.");
    }
    concepts.add(hit.conceptId);
  }
}

export function projectRepositoryKnowledgeSearch(
  input: RepositoryKnowledgeSearchProjectionInputV1,
): ProductUnifiedSearchResultV1 {
  validateInput(input);
  const ranking = input.result.ranking!;
  const queryDigest = digest(input.query);
  const authorizationDigest = digest({
    authorizationCoordinate: input.authorizationCoordinate,
    corpusClasses: ["repository_knowledge"],
  });
  const planIdentity = {
    schemaVersion: 1,
    corpusClasses: ["repository_knowledge"],
    adapterId: input.adapterId,
    adapterBuildId: ranking.adapterBuildId,
    engine: ranking.engine,
  };
  const searchPlan = {
    coordinate: "search-plan:repository-knowledge-v1",
    contentHash: digest(planIdentity),
    engineId: ranking.engine.id,
    engineVersion: ranking.engine.version,
  };
  const hits = input.result.hits.map((hit, index) => ({
    corpusClass: "repository_knowledge" as const,
    sourceCoordinate: `knowledge:${hit.conceptId}`,
    sourceRevision: input.result.sourceSnapshotId,
    contentHash: hit.contentHash,
    privacyClass: "restricted" as const,
    label: hit.title,
    rank: index + 1,
    adapterId: input.adapterId,
    adapterBuildId: ranking.adapterBuildId,
    matchEvidenceKind: "lexical" as const,
  }));
  const receiptIdentity = {
    stageId: "stage:repository-knowledge",
    queryDigest,
    authorizationDigest,
    repositoryRevision: input.repositoryRevision,
    sourceSnapshotId: input.result.sourceSnapshotId,
    impactReportId: input.result.impactReportId,
    planHash: searchPlan.contentHash,
    orderedHits: hits.map((hit) => [hit.sourceCoordinate, hit.contentHash]),
  };
  const resultWithoutDigest = {
    schemaVersion: 1 as const,
    kind: "product_surface.search" as const,
    queryDigest,
    authorizationDigest,
    requestedCorpusClasses: ["repository_knowledge" as const],
    limit: input.limit,
    repositoryRevision: input.repositoryRevision,
    searchPlan,
    stageReceipts: [
      {
        stageId: "stage:repository-knowledge",
        required: true,
        status: "completed" as const,
        reasonCode: null,
        adapterId: input.adapterId,
        adapterBuildId: ranking.adapterBuildId,
        receiptHash: digest(receiptIdentity),
      },
    ],
    groups: [
      {
        corpusClass: "repository_knowledge" as const,
        status: "complete" as const,
        reasonCode: null,
        sourceCoordinates: [input.result.sourceSnapshotId, input.result.impactReportId],
        hits,
      },
    ],
    status: hits.length === 0 ? ("empty" as const) : ("complete" as const),
    reasonCode: null,
  };
  return { ...resultWithoutDigest, resultDigest: digest(resultWithoutDigest) };
}
