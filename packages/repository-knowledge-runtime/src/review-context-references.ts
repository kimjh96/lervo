import { reviewReferences, type ReviewReferenceSet } from "@lervo/repository-knowledge";

import type { SemanticReviewContextDocument } from "./review-context.js";

/**
 * ADR-0604: the canonical context documents a reviewer may quote, each under a reference `c<n>`
 * paired with its path. The reviewer sees the document bytes, never their hash.
 */
export function contextDocumentReferences(
  documents: readonly SemanticReviewContextDocument[],
): ReviewReferenceSet<SemanticReviewContextDocument> {
  return reviewReferences(documents, { prefix: "c", path: (document) => document.path });
}

/** The context as the reviewer sees it: references in place of content hashes. */
export function contextDocumentView(references: ReviewReferenceSet<SemanticReviewContextDocument>) {
  return references.items.map((document, index) => ({
    document: references.reference(index),
    path: document.path,
    role: document.role,
    content: document.content,
  }));
}

/**
 * The `{ document, path }` schema properties that cite one context document, or null when there is
 * no context to cite.
 */
export function contextCitationProperties(
  references: ReviewReferenceSet<SemanticReviewContextDocument>,
): { document: { enum: string[] }; path: { enum: string[] } } | null {
  return references.schema === null || references.pathSchema === null
    ? null
    : { document: references.schema, path: references.pathSchema };
}
