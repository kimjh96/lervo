import { posix } from "node:path";

import { discoverInstructionDocuments } from "@lervo/context";
import { loadDocumentRegistry } from "@lervo/project";
import {
  loadRepositoryKnowledgePolicy,
  queryRepositoryKnowledge,
  repositoryPathCanRemainIncluded,
  repositorySourceClassificationForPath,
} from "@lervo/repository-knowledge";
import { productDefaultRepositoryKnowledgeRanker } from "./repository-knowledge-ranker.js";
import { contextQuery, pathTerms, sourceSpecificQueries } from "./knowledge-review-queries.js";
import {
  contextBytes,
  INSTRUCTIONS_WITHIN_CONTEXT_COUNT,
  largestDocument,
  MAXIMUM_CONTEXT_BYTES,
  MAXIMUM_CONTEXT_DOCUMENTS,
  MAXIMUM_INSTRUCTION_DOCUMENTS,
  MAXIMUM_LINKED_DOCUMENTS,
  withinContextBytes,
} from "./knowledge-review-context-bounds.js";
export { reviewContextCandidateLimit } from "./knowledge-review-context-bounds.js";

import {
  KnowledgeReviewContextError,
  loadReviewDocument,
  optionalReviewDocuments,
  type SemanticReviewContextDocument,
  type ReviewContextSkip,
} from "./knowledge-review-document.js";
export {
  KnowledgeReviewContextError,
  type SemanticReviewContextDocument,
  type ReviewContextSkip,
  type ReviewContextSkipReason,
} from "./knowledge-review-document.js";

type CanonicalReviewQuery = (
  input: Parameters<typeof queryRepositoryKnowledge>[0],
) => Promise<{ hits: { path: string; contentHash: string }[] }>;

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
  loadOptional: ReturnType<typeof optionalReviewDocuments>,
): Promise<string[]> {
  const links: string[] = [];
  for (const path of sourcePaths
    .filter((source) => source.endsWith(".md"))
    .sort((left, right) => right.split("/").length - left.split("/").length)) {
    const source = await loadOptional({ repositoryRoot: root, path });
    if (source === null) continue;
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

/**
 * Every applicable instruction, all required: the `AGENTS.md` chain and the owner rules. Bytes,
 * not their count, bound them; over the bound the review stops and names the largest (ADR-0659).
 */
async function loadRequiredInstructions(input: {
  repositoryRoot: string;
  sourcePaths: readonly string[];
}): Promise<{ instructionPaths: string[]; documents: SemanticReviewContextDocument[] }> {
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
    throw new KnowledgeReviewContextError("review_context_limit_exceeded", {
      documentPath: instructionPaths[MAXIMUM_INSTRUCTION_DOCUMENTS]!,
    });

  const documents: SemanticReviewContextDocument[] = [];
  for (const path of instructionPaths)
    documents.push(
      await loadReviewDocument({ repositoryRoot: input.repositoryRoot, path, role: "instruction" }),
    );
  // Required instructions are never dropped: when they alone exceed the bound, the review stops
  // and names the largest one, which the owner can shorten.
  if (contextBytes(documents) > MAXIMUM_CONTEXT_BYTES)
    throw new KnowledgeReviewContextError("review_context_limit_exceeded", {
      documentPath: largestDocument(documents).path,
    });
  return { instructionPaths, documents };
}

/** Loads exact source-adjacent instructions and bounded current knowledge recommendations. */
export async function loadCanonicalReviewContext(input: {
  repositoryRoot: string;
  sourcePaths: readonly string[];
  queryKnowledge?: CanonicalReviewQuery;
  onSkipped?: (skip: ReviewContextSkip) => void;
}): Promise<SemanticReviewContextDocument[]> {
  const loadOptional = optionalReviewDocuments(input.onSkipped);
  const loadQuerySource = (path: string, maximumBytes: number) =>
    loadOptional({ repositoryRoot: input.repositoryRoot, path, maximumBytes });
  const { instructionPaths, documents } = await loadRequiredInstructions(input);
  const contextLimit =
    MAXIMUM_CONTEXT_DOCUMENTS +
    Math.max(0, instructionPaths.length - INSTRUCTIONS_WITHIN_CONTEXT_COUNT);
  const recommended: string[] = [];

  let policy: Awaited<ReturnType<typeof loadRepositoryKnowledgePolicy>>;
  try {
    policy = await loadRepositoryKnowledgePolicy(input.repositoryRoot);
  } catch (error) {
    throw new KnowledgeReviewContextError("review_context_unavailable", { cause: error });
  }
  const excluded = new Set([...instructionPaths, ...input.sourcePaths]);
  const focusedPaths = new Set<string>();
  for (const path of await linkedSourceDocuments(
    input.repositoryRoot,
    input.sourcePaths,
    loadOptional,
  )) {
    if (documents.length >= contextLimit) break;
    if (
      excluded.has(path) ||
      !repositoryPathCanRemainIncluded(path, policy) ||
      repositorySourceClassificationForPath(path) !== "ordinary" ||
      path.startsWith(`${policy.publicationRoot}/`)
    )
      continue;
    const document = await loadOptional({
      repositoryRoot: input.repositoryRoot,
      path,
    });
    if (document === null) continue;
    documents.push(document);
    excluded.add(path);
  }

  for (const source of input.sourcePaths.filter(
    (path) => path.startsWith(".") && !path.includes("/") && !path.endsWith(".md"),
  )) {
    if (documents.length >= contextLimit) break;
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
    const document = await loadOptional({
      repositoryRoot: input.repositoryRoot,
      path: hit.path,
      expectedHash: hit.contentHash,
    });
    if (document === null) continue;
    documents.push(document);
    excluded.add(hit.path);
    focusedPaths.add(hit.path);
  }

  let focusedQueries: Awaited<ReturnType<typeof sourceSpecificQueries>>;
  try {
    focusedQueries = await sourceSpecificQueries(
      input.repositoryRoot,
      input.sourcePaths,
      loadQuerySource,
    );
  } catch (error) {
    throw new KnowledgeReviewContextError("review_context_unavailable", { cause: error });
  }
  for (const focused of focusedQueries) {
    if (documents.length >= contextLimit) break;
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
    const document = await loadOptional({
      repositoryRoot: input.repositoryRoot,
      path: hit.path,
      expectedHash: hit.contentHash,
    });
    if (document === null) continue;
    documents.push(document);
    excluded.add(hit.path);
    focusedPaths.add(hit.path);
  }

  let recommendations: Awaited<ReturnType<CanonicalReviewQuery>>;
  try {
    recommendations = await (input.queryKnowledge ?? queryRepositoryKnowledge)({
      repositoryRoot: input.repositoryRoot,
      query: await contextQuery(input.repositoryRoot, input.sourcePaths, loadQuerySource),
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
    if (documents.length >= contextLimit) break;
    // ADR-0486: the publication root is a rebuildable projection that every refresh rewrites, so
    // binding its bytes made a waiting review stale without any canonical change.
    if (
      excluded.has(hit.path) ||
      !repositoryPathCanRemainIncluded(hit.path, policy) ||
      repositorySourceClassificationForPath(hit.path) !== "ordinary" ||
      hit.path.startsWith(`${policy.publicationRoot}/`)
    )
      continue;
    const document = await loadOptional({
      repositoryRoot: input.repositoryRoot,
      path: hit.path,
      expectedHash: hit.contentHash,
    });
    if (document === null) continue;
    documents.push(document);
    excluded.add(hit.path);
    recommended.push(hit.path);
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
    if (documents.length >= contextLimit + MAXIMUM_LINKED_DOCUMENTS) break;
    if (excluded.has(path)) continue;
    if (
      !repositoryPathCanRemainIncluded(path, policy) ||
      repositorySourceClassificationForPath(path) !== "ordinary" ||
      path.startsWith(`${policy.publicationRoot}/`)
    )
      continue;
    const document = await loadOptional({
      repositoryRoot: input.repositoryRoot,
      path,
    });
    if (document === null) continue;
    documents.push(document);
    excluded.add(path);
  }
  return withinContextBytes(documents, recommended, input.onSkipped);
}
