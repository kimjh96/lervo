import type { SemanticReviewContextDocument } from "@lervo/repository-context";

const MAXIMUM_ASSESSMENT_CONTEXT_DOCUMENTS = 28;

/** Keep every applicable instruction, then the highest-ranked exact canonical references. */
export function selectCanonicalAssessmentContext(
  context: readonly SemanticReviewContextDocument[],
): SemanticReviewContextDocument[] {
  const instructions = context.filter((document) => document.role === "instruction");
  return [
    ...instructions,
    ...context
      .filter((document) => document.role === "canonical_candidate")
      .slice(0, Math.max(0, MAXIMUM_ASSESSMENT_CONTEXT_DOCUMENTS - instructions.length)),
  ];
}
