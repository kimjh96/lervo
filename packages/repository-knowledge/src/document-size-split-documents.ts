// ADR-0653: planning each document of a size split: its parts' paths checked, its lineage, its
// user writes, and the scan as it will read after them.
import { posix } from "node:path";

import {
  byteOffset,
  restoreSplitPiece,
  splitDocuments,
  type SplitDocument,
  type SplitPiece,
} from "./document-size-split-layout.js";
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

/**
 * A rewritten link of the split that names a split document or one of its parts that the final
 * plan does not write, or null. Every other destination is the reader's own business.
 */
function missingTarget(
  split: SplitDocument,
  planned: ReadonlySet<string>,
  splitPaths: readonly string[],
) {
  for (const piece of [split.index, ...split.parts])
    for (const rewrite of piece.rewrites) {
      const path = /^([^?#]*)/u.exec(rewrite.after)?.[1] ?? "";
      if (path.length === 0) continue;
      let target: string;
      try {
        target = posix.normalize(posix.join(posix.dirname(piece.path), decodeURI(path)));
      } catch {
        return rewrite.after;
      }
      const intoSplit = splitPaths.some(
        (document) => target === document || target.startsWith(`${document.slice(0, -3)}/`),
      );
      if (intoSplit && !planned.has(target)) return rewrite.after;
    }
  return null;
}

/**
 * Every document's split planned in order, and what the plan defers, keeps whole, or leaves
 * unsplit. A document whose split fails its own check, names a part path that is taken, or links
 * to a part the final plan does not write is reported as failed; it never blocks the others.
 */
export async function planSplits(input: {
  root: string;
  scan: RepositoryKnowledgeScan;
  policy: ScannedPolicy;
  generatedPaths: ReadonlySet<string>;
  sources: readonly SplitSource[];
  boundBytes: number;
  registered: (path: string) => boolean;
}): Promise<{
  virtualScan: RepositoryKnowledgeScan;
  planned: PlannedDocument[];
  deferred: DocumentSizeSplitPlan["deferred"];
  unsplittable: DocumentSizeSplitPlan["unsplittable"];
  failed: DocumentSizeSplitPlan["failed"];
  anchors: SplitAnchorFiles;
}> {
  const { root, scan, policy, generatedPaths, sources, boundBytes } = input;
  const deferred: DocumentSizeSplitPlan["deferred"] = [];
  const unsplittable: DocumentSizeSplitPlan["unsplittable"] = [];
  const failed: DocumentSizeSplitPlan["failed"] = [];
  const splittable = sources.filter((source) => {
    if (source.data) return false;
    if (source.unread || input.registered(source.path)) return true;
    deferred.push({ path: source.path, byteCount: source.byteCount });
    return false;
  });
  let accepted: Array<{ source: SplitSource; split: SplitDocument }> = [];
  for (const { source, split } of splitDocuments(splittable, boundBytes)) {
    if (typeof split === "string") {
      unsplittable.push({ path: source.path, byteCount: source.byteCount, reason: split });
      continue;
    }
    const reason = selfCheckFailure(source, split);
    if (reason === null) accepted.push({ source, split });
    else failed.push({ path: source.path, reason: `document_split_failed: ${reason}` });
  }
  // A link into a document that failed points to parts no one writes; its document fails too.
  for (let changed = true; changed;) {
    changed = false;
    const files = new Set(
      accepted.flatMap(({ split }) => [split.path, ...split.parts.map((part) => part.path)]),
    );
    const splitPaths = splittable.map((source) => source.path);
    accepted = accepted.filter(({ source, split }) => {
      const target = missingTarget(split, files, splitPaths);
      if (target === null) return true;
      failed.push({
        path: source.path,
        reason: `document_split_failed: a link names ${target}, which the plan does not write`,
      });
      changed = true;
      return false;
    });
  }
  let virtualScan = scan;
  const planned: PlannedDocument[] = [];
  for (const { source, split } of accepted) {
    try {
      const document = await planDocument({
        root,
        scan,
        virtualScan,
        policy,
        generatedPaths,
        source,
        split,
      });
      virtualScan = document.scan;
      planned.push(document);
    } catch (error) {
      if (!(error instanceof RepositoryKnowledgeError)) throw error;
      failed.push({ path: source.path, reason: `document_split_failed: ${error.message}` });
    }
  }
  const plannedPaths = new Set(planned.map((item) => item.document.path));
  return {
    virtualScan,
    planned,
    deferred,
    unsplittable,
    failed: failed.sort((left, right) => left.path.localeCompare(right.path)),
    anchors: new Map(
      accepted
        .filter(({ source }) => plannedPaths.has(source.path))
        .map(({ source, split }) => [source.path, split.anchors] as const),
    ),
  };
}
