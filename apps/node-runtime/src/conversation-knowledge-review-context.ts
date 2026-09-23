import { createHash } from "node:crypto";

import { discoverInstructionDocuments, readRepositoryFile } from "@lervo/context";
import { loadDocumentRegistry } from "@lervo/project";
import { queryRepositoryKnowledge } from "@lervo/repository-knowledge";
import { productDefaultRepositoryKnowledgeRanker } from "@lervo/repository-context";

import type { SemanticReviewContextDocument } from "./conversation-knowledge-semantic-review.js";

const MAXIMUM_CONTEXT_DOCUMENTS = 8;
const MAXIMUM_DOCUMENT_BYTES = 128 * 1024;
const MAXIMUM_RECOMMENDATIONS = 32;

export class ConversationKnowledgeReviewContextError extends Error {
  constructor(
    readonly code:
      "review_context_unavailable" | "review_context_limit_exceeded" | "review_context_stale",
    options?: ErrorOptions,
  ) {
    super(`Conversation knowledge review context failed: ${code}.`, options);
    this.name = "ConversationKnowledgeReviewContextError";
  }
}

function hash(bytes: Uint8Array): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function pathTerms(path: string): Set<string> {
  return new Set(
    path
      .normalize("NFKC")
      .toLocaleLowerCase()
      .match(/[\p{L}\p{N}]{2,}/gu) ?? [],
  );
}

function prioritizeSourceAdjacentRecommendations<T extends { path: string }>(
  hits: readonly T[],
  sourcePaths: readonly string[],
): T[] {
  const sourceTerms = new Set(sourcePaths.flatMap((path) => [...pathTerms(path)]));
  return hits
    .map((hit, index) => ({
      hit,
      index,
      sharedPathTerms: [...pathTerms(hit.path)].filter((term) => sourceTerms.has(term)).length,
    }))
    .sort((left, right) => right.sharedPathTerms - left.sharedPathTerms || left.index - right.index)
    .map(({ hit }) => hit);
}

async function loadDocument(input: {
  repositoryRoot: string;
  path: string;
  role: SemanticReviewContextDocument["role"];
  expectedHash?: string;
}): Promise<SemanticReviewContextDocument> {
  let bytes: Uint8Array;
  try {
    bytes = await readRepositoryFile(input.repositoryRoot, input.path, MAXIMUM_DOCUMENT_BYTES);
  } catch (error) {
    throw new ConversationKnowledgeReviewContextError("review_context_unavailable", {
      cause: error,
    });
  }
  const contentHash = hash(bytes);
  if (input.expectedHash !== undefined && input.expectedHash !== contentHash)
    throw new ConversationKnowledgeReviewContextError("review_context_stale");
  let content: string;
  try {
    content = new TextDecoder("utf8", { fatal: true }).decode(bytes);
  } catch (error) {
    throw new ConversationKnowledgeReviewContextError("review_context_unavailable", {
      cause: error,
    });
  }
  return { path: input.path, role: input.role, contentHash, content };
}

/** Loads exact source-adjacent instructions and bounded current knowledge recommendations. */
export async function loadConversationKnowledgeReviewContext(input: {
  repositoryRoot: string;
  sourcePaths: readonly string[];
  queryKnowledge?: typeof queryRepositoryKnowledge;
}): Promise<SemanticReviewContextDocument[]> {
  let instructionPaths: string[];
  try {
    const registry = await loadDocumentRegistry(input.repositoryRoot);
    const instructions = await discoverInstructionDocuments({
      repositoryRoot: input.repositoryRoot,
      registry,
      expectedPaths: input.sourcePaths,
    });
    instructionPaths = instructions.map((item) => item.path);
  } catch (error) {
    throw new ConversationKnowledgeReviewContextError("review_context_unavailable", {
      cause: error,
    });
  }
  if (instructionPaths.length === 0)
    throw new ConversationKnowledgeReviewContextError("review_context_unavailable");
  if (instructionPaths.length > MAXIMUM_CONTEXT_DOCUMENTS)
    throw new ConversationKnowledgeReviewContextError("review_context_limit_exceeded");

  const documents: SemanticReviewContextDocument[] = [];
  for (const path of instructionPaths)
    documents.push(
      await loadDocument({ repositoryRoot: input.repositoryRoot, path, role: "instruction" }),
    );

  let recommendations: Awaited<ReturnType<typeof queryRepositoryKnowledge>>;
  try {
    recommendations = await (input.queryKnowledge ?? queryRepositoryKnowledge)({
      repositoryRoot: input.repositoryRoot,
      query: `repository knowledge canonicalization ${input.sourcePaths.join(" ")}`,
      limit: MAXIMUM_RECOMMENDATIONS,
      ranker: productDefaultRepositoryKnowledgeRanker,
    });
  } catch (error) {
    throw new ConversationKnowledgeReviewContextError("review_context_unavailable", {
      cause: error,
    });
  }
  const excluded = new Set([...instructionPaths, ...input.sourcePaths]);
  for (const hit of prioritizeSourceAdjacentRecommendations(
    recommendations.hits,
    input.sourcePaths,
  )) {
    if (documents.length === MAXIMUM_CONTEXT_DOCUMENTS) break;
    if (excluded.has(hit.path)) continue;
    documents.push(
      await loadDocument({
        repositoryRoot: input.repositoryRoot,
        path: hit.path,
        role: "canonical_candidate",
        expectedHash: hit.contentHash,
      }),
    );
    excluded.add(hit.path);
  }
  return documents;
}
