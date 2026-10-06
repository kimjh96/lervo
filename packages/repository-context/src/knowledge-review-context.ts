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
import { contextQuery, pathTerms, sourceSpecificQueries } from "./knowledge-review-queries.js";

export interface SemanticReviewContextDocument {
  path: string;
  role: "instruction" | "canonical_candidate";
  contentHash: string;
  content: string;
}

type CanonicalReviewQuery = (
  input: Parameters<typeof queryRepositoryKnowledge>[0],
) => Promise<{ hits: { path: string; contentHash: string }[] }>;

const MAXIMUM_CONTEXT_DOCUMENTS = 20;
const MAXIMUM_INSTRUCTION_DOCUMENTS = 8;
const MAXIMUM_LINKED_DOCUMENTS = 8;
const MAXIMUM_CONTEXT_BYTES = 1024 * 1024;
const MAXIMUM_DOCUMENT_BYTES = 128 * 1024;
const MAXIMUM_RECOMMENDATIONS = 32;
const GENERIC_DIRECTORY_TERMS = new Set([
  "apps",
  "docs",
  "github",
  "packages",
  "src",
  "test",
  "tests",
  "workflows",
]);

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

async function linkedSourceDocuments(
  root: string,
  sourcePaths: readonly string[],
): Promise<string[]> {
  const links: string[] = [];
  for (const path of sourcePaths
    .filter((source) => source.endsWith(".md"))
    .sort((left, right) => right.split("/").length - left.split("/").length)) {
    let source: SemanticReviewContextDocument;
    try {
      source = await loadDocument({ repositoryRoot: root, path, role: "canonical_candidate" });
    } catch (error) {
      if (
        error instanceof KnowledgeReviewContextError &&
        error.cause instanceof ContextPreparationError &&
        error.cause.code === "document_missing"
      )
        continue;
      throw error;
    }
    for (const link of linkedRepositoryPaths(source))
      if (link.endsWith(".md") && !links.includes(link)) links.push(link);
  }
  return links;
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

function sourceRelevantInstructionReferences(
  document: SemanticReviewContextDocument,
  sourceTerms: ReadonlySet<string>,
): string[] {
  if (document.role !== "instruction" || !document.path.endsWith(".md")) return [];
  return document.content.split("\n").flatMap((line) => {
    if ([...pathTerms(line)].filter((term) => sourceTerms.has(term)).length < 2) return [];
    return [...line.matchAll(/`(docs\/[a-zA-Z0-9._/-]+\.md)`/g)].map((match) => match[1]!);
  });
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
  if (instructionPaths.length > MAXIMUM_INSTRUCTION_DOCUMENTS)
    throw new KnowledgeReviewContextError("review_context_limit_exceeded");

  const documents: SemanticReviewContextDocument[] = [];
  for (const path of instructionPaths)
    documents.push(
      await loadDocument({ repositoryRoot: input.repositoryRoot, path, role: "instruction" }),
    );

  let policy: Awaited<ReturnType<typeof loadRepositoryKnowledgePolicy>>;
  try {
    policy = await loadRepositoryKnowledgePolicy(input.repositoryRoot);
  } catch (error) {
    throw new KnowledgeReviewContextError("review_context_unavailable", { cause: error });
  }
  const excluded = new Set([...instructionPaths, ...input.sourcePaths]);
  const focusedPaths = new Set<string>();
  for (const path of await linkedSourceDocuments(input.repositoryRoot, input.sourcePaths)) {
    if (documents.length === MAXIMUM_CONTEXT_DOCUMENTS) break;
    if (
      excluded.has(path) ||
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

  for (const source of input.sourcePaths.filter(
    (path) => path.startsWith(".") && !path.includes("/") && !path.endsWith(".md"),
  )) {
    if (documents.length === MAXIMUM_CONTEXT_DOCUMENTS) break;
    let focused: Awaited<ReturnType<CanonicalReviewQuery>>;
    try {
      focused = await (input.queryKnowledge ?? queryRepositoryKnowledge)({
        repositoryRoot: input.repositoryRoot,
        query: source.slice(1),
        limit: 4,
        ranker: productDefaultRepositoryKnowledgeRanker,
      });
    } catch (error) {
      throw new KnowledgeReviewContextError("review_context_unavailable", { cause: error });
    }
    const hit = focused.hits.find(
      (candidate) =>
        !excluded.has(candidate.path) &&
        repositoryPathCanRemainIncluded(candidate.path, policy) &&
        repositorySourceClassificationForPath(candidate.path) === "ordinary" &&
        !candidate.path.startsWith(`${policy.publicationRoot}/`),
    );
    if (hit === undefined) continue;
    documents.push(
      await loadDocument({
        repositoryRoot: input.repositoryRoot,
        path: hit.path,
        role: "canonical_candidate",
        expectedHash: hit.contentHash,
      }),
    );
    excluded.add(hit.path);
    focusedPaths.add(hit.path);
  }

  let focusedQueries: Awaited<ReturnType<typeof sourceSpecificQueries>>;
  try {
    focusedQueries = await sourceSpecificQueries(input.repositoryRoot, input.sourcePaths);
  } catch (error) {
    throw new KnowledgeReviewContextError("review_context_unavailable", { cause: error });
  }
  for (const focused of focusedQueries) {
    if (documents.length === MAXIMUM_CONTEXT_DOCUMENTS) break;
    let result: Awaited<ReturnType<CanonicalReviewQuery>>;
    try {
      result = await (input.queryKnowledge ?? queryRepositoryKnowledge)({
        repositoryRoot: input.repositoryRoot,
        query: focused.query,
        limit: 4,
        ranker: productDefaultRepositoryKnowledgeRanker,
      });
    } catch (error) {
      throw new KnowledgeReviewContextError("review_context_unavailable", { cause: error });
    }
    const hit = result.hits.find(
      (candidate) =>
        !excluded.has(candidate.path) &&
        repositoryPathCanRemainIncluded(candidate.path, policy) &&
        repositorySourceClassificationForPath(candidate.path) === "ordinary" &&
        !candidate.path.startsWith(`${policy.publicationRoot}/`),
    );
    if (!hit) continue;
    documents.push(
      await loadDocument({
        repositoryRoot: input.repositoryRoot,
        path: hit.path,
        role: "canonical_candidate",
        expectedHash: hit.contentHash,
      }),
    );
    excluded.add(hit.path);
    focusedPaths.add(hit.path);
  }

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
  const sourceDirectoryTerms = new Set(
    input.sourcePaths.flatMap((path) =>
      [...pathTerms(posix.dirname(path))].filter((term) => !GENERIC_DIRECTORY_TERMS.has(term)),
    ),
  );
  const rankedHits = recommendations.hits
    .map((hit, index) => ({
      hit,
      index,
      affinity: [...pathTerms(posix.dirname(hit.path))].filter((term) =>
        sourceDirectoryTerms.has(term),
      ).length,
    }))
    .sort((left, right) => right.affinity - left.affinity || left.index - right.index);
  for (const { hit } of rankedHits) {
    if (documents.length === MAXIMUM_CONTEXT_DOCUMENTS) break;
    // ADR-0486: the publication root is a rebuildable projection that every refresh rewrites, so
    // binding its bytes made a waiting review stale without any canonical change.
    if (
      excluded.has(hit.path) ||
      !repositoryPathCanRemainIncluded(hit.path, policy) ||
      repositorySourceClassificationForPath(hit.path) !== "ordinary" ||
      hit.path.startsWith(`${policy.publicationRoot}/`)
    )
      continue;
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
    ...documents
      .filter((document) => focusedPaths.has(document.path))
      .flatMap(linkedChildDocuments),
    ...documents.flatMap((document) => sourceRelevantInstructionReferences(document, sourceTerms)),
    ...sourceRelevantDocuments.flatMap(({ document }) =>
      linkedRepositoryPaths(document).filter((path) => /\.(?:md|ts)$/u.test(path)),
    ),
    ...documents.flatMap(linkedChildDocuments),
    ...documents.flatMap(linkedInstructionDocuments),
  ];
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
