// Review context bounds (ADR-0657): bytes, not the number of required instructions, bound what a
// reviewer receives, and optional recommendations give way to them first.
import {
  KnowledgeReviewContextError,
  type ReviewContextSkip,
  type SemanticReviewContextDocument,
} from "./knowledge-review-document.js";

export const MAXIMUM_CONTEXT_DOCUMENTS = 20;
/**
 * Instructions that share the context document count with candidates; more of them add slots
 * instead of displacing candidates. Owner rules accumulate through intake, so every applicable
 * instruction reaches the reviewer and only bytes bound them (ADR-0657).
 */
export const INSTRUCTIONS_WITHIN_CONTEXT_COUNT = 8;
/** A sanity bound far above any real instruction set; the byte bound is the working limit. */
export const MAXIMUM_INSTRUCTION_DOCUMENTS = 256;
export const MAXIMUM_LINKED_DOCUMENTS = 8;

/**
 * The most candidate documents review context holds beside `instructionCount` instructions. A
 * consumer that trims context uses the same limit, so it never cuts what the loader kept.
 */
export function reviewContextCandidateLimit(instructionCount: number): number {
  return (
    MAXIMUM_CONTEXT_DOCUMENTS +
    MAXIMUM_LINKED_DOCUMENTS -
    Math.min(instructionCount, INSTRUCTIONS_WITHIN_CONTEXT_COUNT)
  );
}
export const MAXIMUM_CONTEXT_BYTES = 1024 * 1024;

export function contextBytes(documents: readonly SemanticReviewContextDocument[]): number {
  return documents.reduce((total, document) => total + Buffer.byteLength(document.content), 0);
}

export function largestDocument(
  documents: readonly SemanticReviewContextDocument[],
): SemanticReviewContextDocument {
  return documents.reduce((largest, document) =>
    Buffer.byteLength(document.content) > Buffer.byteLength(largest.content) ? document : largest,
  );
}

/**
 * Fits the context into its byte bound by leaving out the lowest-ranked general recommendations
 * first, each recorded as a `context_budget` skip. Instructions, source-linked and focused
 * documents, and linked contracts stay; if they alone exceed the bound, the review stops and names
 * the largest of them, so it never repeats a bare limit (ADR-0657).
 */
export function withinContextBytes(
  documents: SemanticReviewContextDocument[],
  recommended: string[],
  onSkipped?: (skip: ReviewContextSkip) => void,
): SemanticReviewContextDocument[] {
  let kept = documents;
  while (contextBytes(kept) > MAXIMUM_CONTEXT_BYTES && recommended.length > 0) {
    const path = recommended.pop()!;
    kept = kept.filter((document) => document.path !== path);
    onSkipped?.({ path, reason: "context_budget" });
  }
  if (contextBytes(kept) > MAXIMUM_CONTEXT_BYTES)
    throw new KnowledgeReviewContextError("review_context_limit_exceeded", {
      documentPath: largestDocument(kept).path,
    });
  return kept;
}
