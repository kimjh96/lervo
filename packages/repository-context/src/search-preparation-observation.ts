import { createHash } from "node:crypto";

import { observeContextPreparation, type GraphDocumentRecommendation } from "@lervo/context";
import { assertSearchRecommendationBatch, type SearchRecommendationBatch } from "@lervo/search";

/** Normalize existing selection receipts without treating index reads as provider-context loads. */
export function observeSearchPreparation(input: {
  query: string;
  corpusCoverage?: "unobserved" | "incomplete";
  sourceSnapshotId: string | null;
  recommendationBatches: readonly SearchRecommendationBatch[];
  graphRecommendations: readonly GraphDocumentRecommendation[];
}) {
  if (input.recommendationBatches.length > 2 || input.graphRecommendations.length > 8) {
    throw new TypeError("Context preparation exceeds the current search observation profile.");
  }
  const candidates = new Map<string, string>();
  const selected = new Map<string, string>();
  function add(sourceId: string, contentHash: string, isSelected: boolean): void {
    const existing = candidates.get(sourceId);
    if (existing !== undefined && existing !== contentHash) {
      throw new TypeError("Context preparation contains conflicting source versions.");
    }
    candidates.set(sourceId, contentHash);
    if (isSelected) selected.set(sourceId, contentHash);
  }
  for (const batch of input.recommendationBatches) {
    assertSearchRecommendationBatch(batch);
    for (const item of batch.recommendations) {
      add(
        item.documentId,
        item.sourceContentHash,
        batch.selectedRecommendationIds.includes(item.recommendationId),
      );
    }
  }
  for (const item of input.graphRecommendations)
    add(item.documentId, item.sourceContentHash, item.selected);
  return observeContextPreparation({
    requestDigest: `sha256:${createHash("sha256").update(input.query).digest("hex")}`,
    sourceSnapshotId: input.sourceSnapshotId,
    corpusCoverage: input.corpusCoverage ?? "unobserved",
    retrieval: "completed",
    candidateCount: candidates.size,
    selected: [...selected].map(([sourceId, contentHash]) => ({ sourceId, contentHash })),
    loads: null,
  });
}
