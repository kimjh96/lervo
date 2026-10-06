import type {
  DocumentNormalizationCandidate,
  DocumentNormalizationReviewFeedback,
  KnowledgeConvergenceInput,
} from "@lervo/repository-knowledge";

import {
  boundedReviewReasons,
  MAXIMUM_SOURCE_GENERATION_ATTEMPTS,
  mergeParkedSources,
  parkedPaths,
  type ParkedConvergenceSource,
} from "./convergence-parking.js";
import type { NormalizationSemanticDecision } from "./normalization-review.js";

/** A pre-ADR-0479 rejection kept only its hash; regeneration then says only that it was rejected. */
const UNRETAINED_REASON =
  "An independent reviewer rejected the previous rewrite of this exact source; its reasons were not retained.";

/** One document's rejected generations for one exact content hash. */
export interface NormalizationRejection {
  contentHash: string;
  attempts: number;
  reasons: string[];
}

function reviewReasons(decision: NormalizationSemanticDecision): string[] {
  const failed = Object.entries(decision.checks)
    .filter(([, passed]) => !passed)
    .map(([check]) => check);
  return boundedReviewReasons([
    failed.length
      ? `${decision.rationale} (failed checks: ${failed.join(", ")})`
      : decision.rationale,
  ]);
}

/**
 * ADR-0479 records keyed by source path. A pre-ADR record held only the rejected hash; it counts as
 * one attempt whose reasons are recovered from the obligation's last review when they still match.
 */
export function normalizationRejections(
  state: KnowledgeConvergenceInput,
): Map<string, NormalizationRejection> {
  const records = new Map<string, NormalizationRejection>();
  const current = state.stageData.normalizationRejections as
    Record<string, Partial<NormalizationRejection>> | undefined;
  for (const [path, record] of Object.entries(current ?? {}))
    if (
      typeof record?.contentHash === "string" &&
      Number.isSafeInteger(record.attempts) &&
      Array.isArray(record.reasons)
    )
      records.set(path, {
        contentHash: record.contentHash,
        attempts: record.attempts!,
        reasons: boundedReviewReasons(record.reasons.filter((item) => typeof item === "string")),
      });
  const legacy = state.stageData.normalizationRejected as Record<string, unknown> | undefined;
  const review = state.stageData.normalizationReview as
    { decisions?: NormalizationSemanticDecision[] } | null | undefined;
  for (const [path, contentHash] of Object.entries(legacy ?? {})) {
    if (records.has(path) || typeof contentHash !== "string") continue;
    const decision = review?.decisions?.find(
      (item) => item.decision === "reject" && item.sourceContentHash === contentHash,
    );
    records.set(path, {
      contentHash,
      attempts: 1,
      reasons: decision === undefined ? [] : reviewReasons(decision),
    });
  }
  return records;
}

/** Adds one rejected generation per rejected candidate item, with the reviewer's bounded reasons. */
export function recordNormalizationRejections(
  previous: Map<string, NormalizationRejection>,
  candidate: DocumentNormalizationCandidate,
  decisions: readonly NormalizationSemanticDecision[],
): Record<string, NormalizationRejection> {
  const records = new Map(previous);
  for (const decision of decisions) {
    if (decision.decision !== "reject") continue;
    const item = candidate.items.find((entry) => entry.operationId === decision.operationId)!;
    const prior = records.get(item.sourcePath);
    records.set(item.sourcePath, {
      contentHash: item.sourceContentHash,
      attempts: prior?.contentHash === item.sourceContentHash ? prior.attempts + 1 : 1,
      reasons: reviewReasons(decision),
    });
  }
  return Object.fromEntries([...records].sort(([left], [right]) => left.localeCompare(right)));
}

export type NormalizationAdmission =
  | { kind: "fresh" }
  | { kind: "regenerate"; feedback: DocumentNormalizationReviewFeedback }
  | { kind: "exhausted"; parked: ParkedConvergenceSource };

/** A rejected document regenerates with the reasons until its bounded attempts are exhausted. */
export function normalizationAdmission(
  path: string,
  contentHash: string | undefined,
  rejection: NormalizationRejection | undefined,
): NormalizationAdmission {
  if (rejection === undefined || rejection.contentHash !== contentHash) return { kind: "fresh" };
  if (rejection.attempts < MAXIMUM_SOURCE_GENERATION_ATTEMPTS)
    return {
      kind: "regenerate",
      feedback: {
        attempt: rejection.attempts + 1,
        reasons: rejection.reasons.length ? rejection.reasons : [UNRETAINED_REASON],
      },
    };
  return {
    kind: "exhausted",
    parked: {
      stage: "normalization",
      path,
      contentHash: rejection.contentHash,
      reason: "review_rejected",
      attempts: rejection.attempts,
      reasons: rejection.reasons,
    },
  };
}

/** Partitions pending documents into fresh, regenerating, and parked ones for the exact bytes. */
export function admitNormalizationDocuments(
  pending: readonly string[],
  sources: ReadonlyMap<string, string>,
  rejections: ReadonlyMap<string, NormalizationRejection>,
  parked: readonly ParkedConvergenceSource[],
) {
  const already = parkedPaths(parked, "normalization", (path) => sources.get(path));
  const fresh: string[] = [];
  const regenerate = new Map<string, DocumentNormalizationReviewFeedback>();
  const exhausted: ParkedConvergenceSource[] = [];
  for (const path of pending) {
    if (already.has(path)) continue;
    const decision = normalizationAdmission(path, sources.get(path), rejections.get(path));
    if (decision.kind === "fresh") fresh.push(path);
    else if (decision.kind === "regenerate") regenerate.set(path, decision.feedback);
    else exhausted.push(decision.parked);
  }
  // A parked document that changed bytes or stopped being pending is no longer parked.
  const pendingPaths = new Set(pending);
  return {
    fresh,
    regenerate,
    parked: mergeParkedSources(
      parked.filter(
        (item) =>
          item.stage !== "normalization" || (already.has(item.path) && pendingPaths.has(item.path)),
      ),
      exhausted,
    ),
  };
}
