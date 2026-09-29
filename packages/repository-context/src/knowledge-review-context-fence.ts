import { createHash } from "node:crypto";
import { constants, closeSync, fstatSync, lstatSync, openSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  KnowledgeReviewContextError,
  type SemanticReviewContextDocument,
} from "./knowledge-review-context.js";

/** No awaited read or symlink traversal may intervene between exact context validation and settlement. */
export function assertCanonicalReviewContextCurrent(
  root: string,
  documents: readonly Pick<SemanticReviewContextDocument, "path" | "contentHash">[],
): void {
  for (const document of documents) {
    if (
      !document.path ||
      document.path.includes("\\") ||
      document.path.includes(":") ||
      document.path.includes("\0") ||
      document.path.split("/").some((part) => !part || part === "." || part === "..")
    )
      throw new KnowledgeReviewContextError("review_context_unavailable");
    try {
      let path = resolve(root);
      for (const part of document.path.split("/")) {
        path = resolve(path, part);
        if (lstatSync(path).isSymbolicLink())
          throw new KnowledgeReviewContextError("review_context_unavailable");
      }
      const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        const stat = fstatSync(fd);
        if (!stat.isFile() || stat.size > 128 * 1024)
          throw new KnowledgeReviewContextError("review_context_unavailable");
        if (
          `sha256:${createHash("sha256").update(readFileSync(fd)).digest("hex")}` !==
          document.contentHash
        )
          throw new KnowledgeReviewContextError("review_context_stale");
      } finally {
        closeSync(fd);
      }
    } catch (error) {
      if (error instanceof KnowledgeReviewContextError) throw error;
      throw new KnowledgeReviewContextError("review_context_unavailable", { cause: error });
    }
  }
}
