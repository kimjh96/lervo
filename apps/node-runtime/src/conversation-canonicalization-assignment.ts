import {
  listCanonicalizationCandidates,
  storedNormalizationReviewProcedure,
} from "@lervo/repository-knowledge";

import type {
  NormalizationCandidatePreparer,
  NormalizationReview,
} from "./conversation-normalization-candidate.js";

export interface CanonicalizationAssignment {
  candidateId: string;
  contentHash: string;
  state: "candidate";
  sourcePaths: readonly string[];
  recommendedRoots: readonly string[];
}

/**
 * ADR-0561: the turn documents open candidates in canonical files; the background canonical
 * reviewer then promotes or rejects each one after its independent review. The turn never
 * records a promotion or rejection itself, and stale candidates are the reviewer's alone.
 */
export function canonicalizationAssignment(
  candidates: readonly CanonicalizationAssignment[],
): string | null {
  if (candidates.length === 0) return null;
  return [
    "Background knowledge review left these canonicalization candidates. Unless the current request is read-only research, document each one in this turn after the requested work. The background canonical reviewer then promotes or rejects each candidate itself; never record a promotion or rejection.",
    ...candidates
      .slice(0, 8)
      .map(
        (candidate) =>
          `- ${candidate.candidateId}: sources ${candidate.sourcePaths.slice(0, 8).join(", ")}; canonical roots ${candidate.recommendedRoots.join(", ")}. Update the one canonical document under those roots that should describe the change, or leave it when the change needs no durable documentation.`,
      ),
  ].join("\n");
}

/** Candidates a write-capable turn should document; an unreadable registry assigns none. */
export async function pendingCanonicalizationCandidates(
  repositoryRoot: string,
): Promise<CanonicalizationAssignment[]> {
  try {
    return (await listCanonicalizationCandidates(repositoryRoot)).flatMap((candidate) =>
      candidate.observedState === "candidate"
        ? [
            {
              candidateId: candidate.candidateId,
              contentHash: candidate.contentHash,
              state: candidate.observedState,
              sourcePaths: candidate.sourceBindings.map((binding) => binding.path),
              recommendedRoots: candidate.recommendedRoots,
            },
          ]
        : [],
    );
  } catch {
    return [];
  }
}

export function normalizationAssignment(review: NormalizationReview | null): string | null {
  return review === null
    ? null
    : `Document normalization debt: ${storedNormalizationReviewProcedure(review)}`;
}

/** The knowledge work a write-capable Discord turn owns, read together before the turn. */
export async function readKnowledgeAssignments(input: {
  repositoryRoot: string;
  normalization?: NormalizationCandidatePreparer;
}) {
  const [canonicalizationCandidates, normalizationReview] = await Promise.all([
    pendingCanonicalizationCandidates(input.repositoryRoot),
    input.normalization === undefined ? null : input.normalization.review().catch(() => null),
  ]);
  return { canonicalizationCandidates, normalizationReview };
}
