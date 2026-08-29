import { createHash } from "node:crypto";

import { projectLinkedEvidenceShadow } from "../../packages/context/dist/index.js";
import {
  createSearchAttempt,
  createSearchRecommendationBatch,
  LexicalSearchIndex,
} from "../../packages/search/dist/index.js";
import { loadRegisteredDocumentCorpus } from "../../packages/search-local/dist/index.js";

function nonce(value) {
  return createHash("sha256").update(value).digest("hex").slice(0, 32);
}

export async function projectPhaseAPilotQuery(input) {
  const corpus = await loadRegisteredDocumentCorpus(input.pilotRoot);
  const response = await new LexicalSearchIndex(corpus).search(input.query, 5);
  const attempt = createSearchAttempt({
    projectId: input.projectId,
    observedAt: new Date("2026-08-28T00:00:00.000Z"),
    nonce: nonce(`${input.caseId}:${input.query}`),
    response,
  });
  const batch = createSearchRecommendationBatch({
    attempt,
    recommendationLimit: 5,
    maximumSelections: 3,
  });
  const corpusById = new Map(corpus.map((source) => [source.sourceId, source]));
  const selectedIds = new Set(batch.selectedRecommendationIds);
  const recommendations = batch.recommendations
    .filter((item) => selectedIds.has(item.recommendationId))
    .map((item) => {
      const source = corpusById.get(item.documentId);
      if (source?.path === undefined || source.contentHash !== item.sourceContentHash) {
        throw new Error("A pilot recommendation differs from the registered corpus.");
      }
      return {
        documentId: source.sourceId,
        path: source.path,
        contentHash: source.contentHash,
        text: source.text,
      };
    });
  const existingPaths = batch.recommendations.map((item) => {
    const source = corpusById.get(item.documentId);
    if (source?.path === undefined) throw new Error("A pilot recommendation path is unavailable.");
    return source.path;
  });
  const projection = projectLinkedEvidenceShadow({
    corpus: corpus.map((source) => {
      if (source.path === undefined) throw new Error("A registered pilot document has no path.");
      return {
        documentId: source.sourceId,
        path: source.path,
        contentHash: source.contentHash,
        text: source.text,
      };
    }),
    recommendations,
    existingPaths,
  });
  return {
    caseId: input.caseId,
    recommendationCount: recommendations.length,
    candidateCount: projection.candidateCount,
    retainedCount: projection.sources.length,
    ignoredCount: projection.ignoredCount,
    truncated: projection.truncated,
    retainedByteCount: projection.byteCount,
    projectionDigest: projection.projectionDigest,
    sourceSnapshotId: projection.sourceSnapshotId,
    retained: projection.sources.map(({ documentId, contentHash }) => ({
      documentId,
      contentHash,
    })),
  };
}

export async function projectPhaseAPilotSchedule(input) {
  const byCase = new Map();
  for (const run of input.schedule) {
    let projection = byCase.get(run.caseId);
    if (projection === undefined) {
      projection = await projectPhaseAPilotQuery({
        pilotRoot: input.pilotRoot,
        projectId: input.projectId,
        caseId: run.caseId,
        query: run.query,
      });
      byCase.set(run.caseId, projection);
    }
  }
  return input.schedule.map((run) => ({ ordinal: run.ordinal, ...byCase.get(run.caseId) }));
}
