export {
  KnowledgeReviewContextError,
  type SemanticReviewContextDocument,
  type ReviewContextSkip,
} from "@lervo/repository-context";
import {
  loadCanonicalReviewContext as loadContext,
  type ReviewContextSkip,
} from "@lervo/repository-context";

/** Keep skip evidence separate from the exact loaded bindings passed to both reviewers. */
export async function loadCanonicalReviewContext(input: Parameters<typeof loadContext>[0]) {
  const skipped: ReviewContextSkip[] = [];
  const documents = await loadContext({ ...input, onSkipped: (item) => skipped.push(item) });
  return { documents, skipped };
}

/** Private CAS evidence may identify the failed repository document; events keep only the code. */
export function reviewContextFailureDetail(error: unknown) {
  for (let depth = 0; depth < 8 && error instanceof Error; depth++, error = error.cause) {
    const detail = error as Error & { documentPath?: unknown; documentReason?: unknown };
    if (
      typeof detail.documentPath === "string" &&
      detail.documentPath.length <= 500 &&
      !/[\\:\0]/u.test(detail.documentPath) &&
      detail.documentPath.split("/").every((part) => part && part !== "." && part !== "..")
    )
      return {
        documentPath: detail.documentPath,
        documentReason: typeof detail.documentReason === "string" ? detail.documentReason : null,
      };
  }
  return { documentPath: null, documentReason: null };
}
