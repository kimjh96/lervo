import { createHash } from "node:crypto";
import { ContextPreparationError, readRepositoryFile } from "@lervo/context";

export interface SemanticReviewContextDocument {
  path: string;
  role: "instruction" | "canonical_candidate";
  contentHash: string;
  content: string;
}

export type ReviewContextSkipReason =
  | "document_missing"
  | "document_read_failed"
  | "unsafe_document_path"
  | "document_changed_during_read"
  | "non_utf8"
  /** A ranked recommendation left out so the context fits its byte bound (ADR-0659). */
  | "context_budget";

/** Private selection evidence only; skipped bytes are never a loaded context binding. */
export interface ReviewContextSkip {
  path: string;
  reason: ReviewContextSkipReason;
}

export class KnowledgeReviewContextError extends Error {
  readonly documentPath: string | undefined;
  readonly documentReason: ReviewContextSkipReason | undefined;
  constructor(
    readonly code:
      "review_context_unavailable" | "review_context_limit_exceeded" | "review_context_stale",
    options?: ErrorOptions & { documentPath?: string; documentReason?: ReviewContextSkipReason },
  ) {
    super(`Conversation knowledge review context failed: ${code}.`, options);
    this.name = "KnowledgeReviewContextError";
    this.documentPath =
      options?.documentPath ??
      (options?.cause as { documentPath?: string } | undefined)?.documentPath;
    this.documentReason = options?.documentReason;
  }
}

function readFailureReason(error: unknown): ReviewContextSkipReason {
  if (error instanceof ContextPreparationError) {
    switch (error.code) {
      case "document_missing":
      case "unsafe_document_path":
      case "document_changed_during_read":
        return error.code;
    }
  }
  // The repository reader deliberately uses this code for both oversized and unreadable files.
  return "document_read_failed";
}

export async function loadReviewDocument(input: {
  repositoryRoot: string;
  path: string;
  role: SemanticReviewContextDocument["role"];
  expectedHash?: string;
  maximumBytes?: number;
}): Promise<SemanticReviewContextDocument> {
  let bytes: Uint8Array;
  try {
    bytes = await readRepositoryFile(
      input.repositoryRoot,
      input.path,
      input.maximumBytes ?? 128 * 1024,
    );
  } catch (error) {
    throw new KnowledgeReviewContextError("review_context_unavailable", {
      cause: error,
      documentPath: input.path,
      documentReason: readFailureReason(error),
    });
  }
  const contentHash = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
  if (input.expectedHash !== undefined && input.expectedHash !== contentHash)
    throw new KnowledgeReviewContextError("review_context_stale", { documentPath: input.path });
  let content: string;
  try {
    content = new TextDecoder("utf8", { fatal: true }).decode(bytes);
  } catch (error) {
    throw new KnowledgeReviewContextError("review_context_unavailable", {
      cause: error,
      documentPath: input.path,
      documentReason: "non_utf8",
    });
  }
  return { path: input.path, role: input.role, contentHash, content };
}

/** Bound optional reads and failure evidence together; required instructions bypass this budget. */
export function optionalReviewDocuments(onSkipped?: (skip: ReviewContextSkip) => void) {
  let reads = 0;
  return async (input: Omit<Parameters<typeof loadReviewDocument>[0], "role">) => {
    if (reads++ >= 64) return null;
    try {
      return await loadReviewDocument({ ...input, role: "canonical_candidate" });
    } catch (error) {
      if (
        !(error instanceof KnowledgeReviewContextError) ||
        error.code !== "review_context_unavailable"
      )
        throw error;
      onSkipped?.({ path: input.path, reason: error.documentReason ?? "document_read_failed" });
      return null;
    }
  };
}
