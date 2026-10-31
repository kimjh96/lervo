import { createHash } from "node:crypto";

import {
  managedLinkedEvidenceDefaultPolicy,
  type ManagedLinkedEvidenceSelection,
} from "@lervo/context";
import type { SearchRecommendationBatch } from "@lervo/search";

import { prepareManagedLinkedEvidenceProjection } from "./managed-linked-evidence-canary-projection.js";

function selectionAttemptId(runId: string): string {
  const suffix = createHash("sha256")
    .update(`${managedLinkedEvidenceDefaultPolicy.id}:${runId}`)
    .digest("hex")
    .slice(0, 24);
  return `lsel_${suffix}`;
}

/** Retained only for source-bound paired evaluation; ordinary application composition never calls it. */
export async function resolveDefaultManagedLinkedEvidenceSelection(input: {
  repositoryRoot: string;
  runId: string;
  operationalBatch: SearchRecommendationBatch;
  recommendationBatches: readonly SearchRecommendationBatch[];
}): Promise<ManagedLinkedEvidenceSelection[]> {
  const projection = await prepareManagedLinkedEvidenceProjection(input);
  const attemptId = selectionAttemptId(input.runId);
  return projection.candidates.map((candidate, index) => ({
    schemaVersion: 1,
    selectionAttemptId: attemptId,
    documentId: candidate.documentId,
    path: candidate.path,
    contentHash: candidate.contentHash,
    rank: index + 1,
  }));
}
