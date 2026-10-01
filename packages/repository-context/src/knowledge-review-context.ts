import { createHash } from "node:crypto";
import { posix } from "node:path";

import {
  ContextPreparationError,
  discoverInstructionDocuments,
  readRepositoryFile,
} from "@lervo/context";
import { loadDocumentRegistry } from "@lervo/project";
import {
  loadRepositoryKnowledgePolicy,
  queryRepositoryKnowledge,
  repositoryPathCanRemainIncluded,
  repositorySourceClassificationForPath,
} from "@lervo/repository-knowledge";
import { productDefaultRepositoryKnowledgeRanker } from "./repository-knowledge-ranker.js";

export interface SemanticReviewContextDocument {
  path: string;
  role: "instruction" | "canonical_candidate";
  contentHash: string;
  content: string;
}

type CanonicalReviewQuery = (
  input: Parameters<typeof queryRepositoryKnowledge>[0],
) => Promise<{ hits: { path: string; contentHash: string }[] }>;

const MAXIMUM_CONTEXT_DOCUMENTS = 8;
const MAXIMUM_LINKED_DOCUMENTS = 4;
const MAXIMUM_CONTEXT_BYTES = 1024 * 1024;
const MAXIMUM_DOCUMENT_BYTES = 128 * 1024;
const MAXIMUM_RECOMMENDATIONS = 32;

export class KnowledgeReviewContextError extends Error {
  constructor(
    readonly code:
      "review_context_unavailable" | "review_context_limit_exceeded" | "review_context_stale",
    options?: ErrorOptions,
  ) {
    super(`Conversation knowledge review context failed: ${code}.`, options);
    this.name = "KnowledgeReviewContextError";
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

async function contextQuery(root: string, paths: readonly string[]): Promise<string> {
  const terms: string[] = [];
  const add = (values: Iterable<string>, maximum: number) => {
    let added = 0;
    for (const term of values) {
      if (terms.length === 32 || added === maximum) break;
      if (terms.includes(term) || [...terms, term].join(" ").length > 500) continue;
      terms.push(term);
      added += 1;
    }
  };
  add(
    paths.flatMap((path) => [...pathTerms(path)]),
    32,
  );
  for (const path of paths.filter((source) => /\.mdx?$/iu.test(source)).slice(0, 8)) {
    let source: string;
    try {
      source = new TextDecoder("utf8", { fatal: true }).decode(
        await readRepositoryFile(root, path, 256 * 1024),
      );
    } catch (error) {
      if (error instanceof ContextPreparationError && error.code === "document_missing") continue;
      throw new KnowledgeReviewContextError("review_context_unavailable", { cause: error });
    }
    add(
      [...source.matchAll(/^\s{0,3}#{1,6}\s+(.+)$/gmu)].flatMap((match) => [
        ...pathTerms(match[1]!),
      ]),
      12,
    );
    add(
      [...source.matchAll(/`([^`\n]+\.md)`/gu)].flatMap((match) => [...pathTerms(match[1]!)]),
      5,
    );
    add(
      [...source.matchAll(/\bnever\s+([^.!?\n]{0,100})/giu)].flatMap((match) => [
        ...pathTerms(match[1]!),
      ]),
      3,
    );
  }
  return terms.join(" ") || "repository knowledge canonicalization";
}

function linkedRepositoryPaths(document: SemanticReviewContextDocument): string[] {
  if (!document.path.endsWith(".md")) return [];
  const paths: string[] = [];
  for (const match of document.content.matchAll(/\[[^\]]+\]\(([^\s)]+)(?:\s+"[^"]*")?\)/g)) {
    const link = match[1]?.split("#", 1)[0];
    if (!link || link.startsWith("/") || link.includes(":") || link.includes("\\")) continue;
    const path = posix.normalize(posix.join(posix.dirname(document.path), link));
    if (path !== ".." && !path.startsWith("../") && !paths.includes(path)) paths.push(path);
  }
  return paths;
}

function linkedChildDocuments(document: SemanticReviewContextDocument): string[] {
  if (document.role !== "canonical_candidate" || !document.path.endsWith(".md")) return [];
  const childRoot = `${document.path.slice(0, -3)}/`;
  return linkedRepositoryPaths(document).filter(
    (path) => path.startsWith(childRoot) && path.endsWith(".md"),
  );
}

function linkedInstructionDocuments(document: SemanticReviewContextDocument): string[] {
  if (document.role !== "instruction" || !document.path.endsWith(".md")) return [];
  return linkedRepositoryPaths(document).filter(
    (path) => path.startsWith("docs/") && path.endsWith(".md"),
  );
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
    throw new KnowledgeReviewContextError("review_context_unavailable", {
      cause: error,
    });
  }
  const contentHash = hash(bytes);
  if (input.expectedHash !== undefined && input.expectedHash !== contentHash)
    throw new KnowledgeReviewContextError("review_context_stale");
  let content: string;
  try {
    content = new TextDecoder("utf8", { fatal: true }).decode(bytes);
  } catch (error) {
    throw new KnowledgeReviewContextError("review_context_unavailable", {
      cause: error,
    });
  }
  return { path: input.path, role: input.role, contentHash, content };
}

/** Loads exact source-adjacent instructions and bounded current knowledge recommendations. */
export async function loadCanonicalReviewContext(input: {
  repositoryRoot: string;
  sourcePaths: readonly string[];
  queryKnowledge?: CanonicalReviewQuery;
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
    throw new KnowledgeReviewContextError("review_context_unavailable", {
      cause: error,
    });
  }
  if (instructionPaths.length === 0)
    throw new KnowledgeReviewContextError("review_context_unavailable");
  if (instructionPaths.length > MAXIMUM_CONTEXT_DOCUMENTS)
    throw new KnowledgeReviewContextError("review_context_limit_exceeded");

  const documents: SemanticReviewContextDocument[] = [];
  for (const path of instructionPaths)
    documents.push(
      await loadDocument({ repositoryRoot: input.repositoryRoot, path, role: "instruction" }),
    );

  let recommendations: Awaited<ReturnType<CanonicalReviewQuery>>;
  try {
    recommendations = await (input.queryKnowledge ?? queryRepositoryKnowledge)({
      repositoryRoot: input.repositoryRoot,
      query: await contextQuery(input.repositoryRoot, input.sourcePaths),
      limit: MAXIMUM_RECOMMENDATIONS,
      ranker: productDefaultRepositoryKnowledgeRanker,
    });
  } catch (error) {
    throw new KnowledgeReviewContextError("review_context_unavailable", {
      cause: error,
    });
  }
  const excluded = new Set([...instructionPaths, ...input.sourcePaths]);
  for (const hit of recommendations.hits) {
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
  const sourceTerms = new Set(
    input.sourcePaths.flatMap((path) => [...pathTerms(path)]).filter((term) => term !== "md"),
  );
  const sourceRelevantDocuments = documents
    .map((document, index) => ({
      document,
      index,
      score: [...pathTerms(document.path)].filter((term) => sourceTerms.has(term)).length,
    }))
    .filter((item) => item.document.role === "canonical_candidate" && item.score > 0)
    .sort((left, right) => right.score - left.score || left.index - right.index);
  const linkedPaths = [
    ...sourceRelevantDocuments.flatMap(({ document }) =>
      linkedRepositoryPaths(document).filter((path) => /\.(?:md|ts)$/u.test(path)),
    ),
    ...documents.flatMap(linkedChildDocuments),
    ...documents.flatMap(linkedInstructionDocuments),
  ];
  let policy: Awaited<ReturnType<typeof loadRepositoryKnowledgePolicy>>;
  try {
    policy = await loadRepositoryKnowledgePolicy(input.repositoryRoot);
  } catch (error) {
    throw new KnowledgeReviewContextError("review_context_unavailable", { cause: error });
  }
  for (const path of linkedPaths) {
    if (documents.length === MAXIMUM_CONTEXT_DOCUMENTS + MAXIMUM_LINKED_DOCUMENTS) break;
    if (excluded.has(path)) continue;
    if (
      !repositoryPathCanRemainIncluded(path, policy) ||
      repositorySourceClassificationForPath(path) !== "ordinary" ||
      path.startsWith(`${policy.publicationRoot}/`)
    )
      continue;
    documents.push(
      await loadDocument({
        repositoryRoot: input.repositoryRoot,
        path,
        role: "canonical_candidate",
      }),
    );
    excluded.add(path);
  }
  if (
    documents.reduce((total, document) => total + Buffer.byteLength(document.content), 0) >
    MAXIMUM_CONTEXT_BYTES
  )
    throw new KnowledgeReviewContextError("review_context_limit_exceeded");
  return documents;
}
