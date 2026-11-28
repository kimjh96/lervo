// ADR-0653: planning each document of a size split: its parts' paths checked, its lineage, its
// user writes, and the scan as it will read after them.
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { brokenRewrites } from "./document-size-split-link-check.js";
import {
  byteOffset,
  restoreSplitPiece,
  type DocumentFacts,
  type SplitDocument,
  type SplitPiece,
} from "./document-size-split-layout.js";
import { splitDocuments } from "./document-size-split-settle.js";
import { splitDocumentFailure } from "./document-size-split-verify.js";
import { assertSafeAbsentDestination } from "./document-structure-split.js";
import type { SplitAnchorFiles } from "./document-size-split-links.js";
import type { DurableKnowledgeUserFileOperation } from "./durable-apply.js";
import type {
  DocumentSizeSplitDocument,
  DocumentSizeSplitPlan,
  DocumentSizeSplitRestoration,
} from "./document-size-split-contract.js";
import { sha256, stableId } from "./integrity.js";
import { isWithinPublicationRoot } from "./repository-publication-files.js";
import {
  repositoryPathCanRemainIncluded,
  splitRepositoryKnowledgeScanSource,
  upsertRepositoryKnowledgeScanSources,
} from "./scanner.js";
import { createDocumentSplitLineage } from "./source-lineage.js";
import { type ScannedPolicy, type SplitSource } from "./document-size-split-sources.js";
import {
  RepositoryKnowledgeError,
  type KnowledgeFileOperation,
  type RepositoryKnowledgeScan,
} from "./types.js";

export interface PlannedDocument {
  document: DocumentSizeSplitDocument;
  scan: RepositoryKnowledgeScan;
  lineageOperations: KnowledgeFileOperation[];
  userOperations: DurableKnowledgeUserFileOperation[];
  lineageIds: string[];
  unsplittable: DocumentSizeSplitPlan["unsplittable"];
}

/** One document's split: its lineage, its user writes, and the scan as it will read after them. */
async function planDocument(input: {
  root: string;
  scan: RepositoryKnowledgeScan;
  virtualScan: RepositoryKnowledgeScan;
  policy: ScannedPolicy;
  generatedPaths: ReadonlySet<string>;
  source: SplitSource;
  split: SplitDocument;
}): Promise<PlannedDocument> {
  const { source, scan, split } = input;
  for (const part of split.parts) {
    await assertSafeAbsentDestination(input.root, part.path);
    if (
      !repositoryPathCanRemainIncluded(part.path, input.policy) ||
      input.generatedPaths.has(part.path) ||
      isWithinPublicationRoot(part.path, input.policy.publicationRoot) ||
      scan.sources.some((item) => item.path === part.path)
    )
      throw new RepositoryKnowledgeError(
        "knowledge_reconciliation_conflict",
        `The split part path ${part.path} is not a new regular document path included by policy.`,
      );
  }
  const afterHash = sha256(split.index.content);
  const sourceUnitIds = scan.units
    .filter((item) => item.sourceId === source.sourceId)
    .map((item) => item.unitId);
  const operationId = stableId("kdocop", {
    projectId: scan.projectId,
    action: "size_split",
    sourceId: source.sourceId,
    sourcePath: source.path,
    sourceBeforeHash: source.contentHash,
    sourceAfterHash: afterHash,
    parts: split.parts.map((part) => [part.path, sha256(part.content)]),
  });
  const planned: PlannedDocument = {
    document: {
      path: source.path,
      beforeHash: source.contentHash,
      beforeByteCount: source.byteCount,
      afterHash,
      afterByteCount: Buffer.byteLength(split.index.content),
      preambleByteCount: byteOffset(source.content, split.index.end),
      partsBlock: split.index.block,
      ...restoration(split.index),
      parts: [],
      unkeptLinks: split.unkept,
    },
    scan: input.virtualScan,
    lineageOperations: [],
    userOperations: [],
    lineageIds: [],
    unsplittable: [],
  };
  for (const part of split.parts) {
    const range = {
      startByte: byteOffset(source.content, part.start),
      endByte: byteOffset(source.content, part.end),
    };
    const contentHash = sha256(part.content);
    if (!source.unread) {
      const lineage = createDocumentSplitLineage({
        projectId: scan.projectId,
        operationId,
        sourcePath: source.path,
        destinationPath: part.path,
        identityPath: source.identityPath ?? source.path,
        sourceId: source.sourceId,
        sourceBeforeHash: source.contentHash,
        sourceBeforeByteCount: source.byteCount,
        sourceAfterHash: afterHash,
        destinationHash: contentHash,
        selectedHeadingLocator: part.part.locator,
        extractedRange: range,
        sourceUnitIds,
      });
      planned.lineageIds.push(lineage.value.lineageId);
      planned.lineageOperations.push({
        path: lineage.file,
        action: "create",
        ownership: "lervo_generated",
        mediaType: "application/yaml",
        content: lineage.content,
        desiredHash: sha256(lineage.content),
      });
      planned.scan = splitRepositoryKnowledgeScanSource({
        scan: planned.scan,
        sourcePath: source.path,
        destinationPath: part.path,
        sourceContent: split.index.content,
        destinationContent: part.content,
      });
    }
    planned.userOperations.push({
      path: part.path,
      action: "create",
      ownership: "user",
      mediaType: "text/markdown",
      content: part.content,
      desiredHash: contentHash,
    });
    const byteCount = Buffer.byteLength(part.content);
    if (part.part.oversized)
      planned.unsplittable.push({ path: part.path, byteCount, reason: "document_unsplittable" });
    planned.document.parts.push({
      path: part.path,
      title: part.part.title,
      ...range,
      contentHash,
      byteCount,
      ...restoration(part),
    });
  }
  // A document the scanner left out for its size had no knowledge identity: its index and parts
  // join the scan as new sources, without a lineage to carry.
  if (source.unread)
    planned.scan = upsertRepositoryKnowledgeScanSources(
      {
        ...planned.scan,
        sources: planned.scan.sources.filter((item) => item.path !== source.path),
      },
      [
        { path: source.path, content: split.index.content },
        ...split.parts.map((part) => ({ path: part.path, content: part.content })),
      ],
    );
  planned.userOperations.push({
    path: source.path,
    action: "update",
    ownership: "user",
    mediaType: "text/markdown",
    content: split.index.content,
    expectedCurrentHash: source.contentHash,
    desiredHash: afterHash,
  });
  return planned;
}

function restoration(piece: SplitPiece): DocumentSizeSplitRestoration {
  return {
    repeatedHeader: piece.header,
    definitionsBefore: piece.prefix,
    definitionsAfter: piece.appendix,
    linkRewrites: piece.rewrites,
  };
}

/** Why a document's split fails its own check, or null when every file restores exactly. */
function selfCheckFailure(source: SplitSource, split: SplitDocument): string | null {
  for (const piece of [split.index, ...split.parts]) {
    const reason = restoreSplitPiece(source.content, piece.content, {
      ...piece,
      ...(piece === split.index ? { block: split.index.block } : {}),
    });
    if (reason !== null) return `${piece.path}: ${reason}`;
  }
  return null;
}

type Failure = { path: string; reason: string };

interface Attempt {
  virtualScan: RepositoryKnowledgeScan;
  planned: PlannedDocument[];
  unsplittable: DocumentSizeSplitPlan["unsplittable"];
  anchors: SplitAnchorFiles;
  writes: Set<string>;
}

/**
 * One attempt at planning `candidates` together: every failure of its first failing stage, or the
 * plan. A stage that fails stops the attempt, so no later stage judges a link into a document
 * that is about to be left whole; the next attempt renders without it.
 */
async function attempt(
  input: Parameters<typeof planSplits>[0],
  candidates: readonly SplitSource[],
  facts: Map<string, DocumentFacts>,
): Promise<{ failures: Failure[] } | Attempt> {
  const unsplittable: DocumentSizeSplitPlan["unsplittable"] = [];
  const accepted: Array<{ source: SplitSource; split: SplitDocument }> = [];
  const failures: Failure[] = [];
  for (const { source, split, settled } of splitDocuments(candidates, input.boundBytes, facts)) {
    if (typeof split === "string")
      unsplittable.push({ path: source.path, byteCount: source.byteCount, reason: split });
    else if (!settled)
      failures.push({
        path: source.path,
        reason: "its links to another split document still moved after the last layout round",
      });
    else {
      const reason = selfCheckFailure(source, split);
      if (reason === null) accepted.push({ source, split });
      else failures.push({ path: source.path, reason });
    }
  }
  if (failures.length > 0) return { failures };
  const anchors: SplitAnchorFiles = new Map(
    accepted.map(({ source, split }) => [source.path, split.anchors] as const),
  );
  const writes = new Set(
    accepted.flatMap(({ split }) => [split.path, ...split.parts.map((part) => part.path)]),
  );
  // Every rewritten link must still name what it named, once the whole plan is written.
  for (const { source, split } of accepted) {
    const broken = brokenRewrites({
      documentPath: source.path,
      pieces: [split.index, ...split.parts],
      writes,
      anchorFiles: anchors,
    });
    if (broken.length > 0)
      failures.push({
        path: source.path,
        reason: `a rewritten link would not resolve: ${broken[0]}`,
      });
  }
  if (failures.length > 0) return { failures };
  let virtualScan = input.scan;
  const planned: PlannedDocument[] = [];
  for (const { source, split } of accepted) {
    try {
      const document = await planDocument({ ...input, virtualScan, source, split });
      const contents = new Map(
        document.userOperations.map((operation) => [operation.path, operation.content] as const),
      );
      const original = (await readFile(resolve(input.root, source.path))).toString("utf8");
      const failure = splitDocumentFailure(original, document.document, contents);
      if (failure !== null)
        throw new RepositoryKnowledgeError(
          "knowledge_reconciliation_conflict",
          `${failure.path} does not restore to its original bytes: ${failure.reason}`,
        );
      virtualScan = document.scan;
      planned.push(document);
    } catch (error) {
      if (!(error instanceof RepositoryKnowledgeError)) throw error;
      failures.push({ path: source.path, reason: error.message });
    }
  }
  if (failures.length > 0) return { failures };
  return { virtualScan, planned, unsplittable, anchors, writes };
}

/**
 * Every document's split planned together, and what the plan defers, keeps whole, or leaves
 * unsplit. A document whose split fails its own check, names a part path that is taken, rewrites
 * a link that would not resolve, or does not restore from its written files is reported as failed
 * and left whole; the others are planned again as if it were never split, so no link names a part
 * no one writes. A failure never blocks the others.
 */
export async function planSplits(input: {
  root: string;
  scan: RepositoryKnowledgeScan;
  policy: ScannedPolicy;
  generatedPaths: ReadonlySet<string>;
  sources: readonly SplitSource[];
  boundBytes: number;
  registered: (path: string) => boolean;
}): Promise<
  Attempt & { deferred: DocumentSizeSplitPlan["deferred"]; failed: DocumentSizeSplitPlan["failed"] }
> {
  const deferred: DocumentSizeSplitPlan["deferred"] = [];
  const failed: DocumentSizeSplitPlan["failed"] = [];
  let candidates = input.sources.filter((source) => {
    if (source.data) return false;
    if (source.unread || input.registered(source.path)) return true;
    deferred.push({ path: source.path, byteCount: source.byteCount });
    return false;
  });
  const facts = new Map<string, DocumentFacts>();
  // Each attempt that fails leaves at least one more document whole, so attempts are bounded.
  for (;;) {
    const result = await attempt(input, candidates, facts);
    if (!("failures" in result))
      return {
        ...result,
        deferred,
        failed: failed.sort((left, right) => left.path.localeCompare(right.path)),
      };
    for (const failure of result.failures)
      failed.push({ path: failure.path, reason: `document_split_failed: ${failure.reason}` });
    const left = new Set(result.failures.map((failure) => failure.path));
    candidates = candidates.filter((source) => !left.has(source.path));
  }
}
