import {
  reviewContextCandidateLimit,
  type ReviewContextSkip,
  type SemanticReviewContextDocument,
} from "@lervo/repository-context";

/**
 * Keep every applicable instruction, then the highest-ranked exact canonical references, up to the
 * loader's own candidate limit, so nothing the loader kept is cut (ADR-0659). A candidate left out
 * anyway is returned as a `context_budget` skip, never dropped silently.
 */
export function selectCanonicalAssessmentContext(
  context: readonly SemanticReviewContextDocument[],
): {
  documents: SemanticReviewContextDocument[];
  skipped: ReviewContextSkip[];
} {
  const instructions = context.filter((document) => document.role === "instruction");
  const candidates = context.filter((document) => document.role === "canonical_candidate");
  const limit = reviewContextCandidateLimit(instructions.length);
  return {
    documents: [...instructions, ...candidates.slice(0, limit)],
    skipped: candidates
      .slice(limit)
      .map((document) => ({ path: document.path, reason: "context_budget" as const })),
  };
}

/** The assessment's documents from loaded context; what it leaves out joins the context skips. */
export function assessmentDocuments(loaded: {
  documents: readonly SemanticReviewContextDocument[];
  skipped: ReviewContextSkip[];
}): SemanticReviewContextDocument[] {
  const selection = selectCanonicalAssessmentContext(loaded.documents);
  loaded.skipped.push(...selection.skipped);
  return selection.documents;
}
