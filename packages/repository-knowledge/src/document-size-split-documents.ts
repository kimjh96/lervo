// ADR-0653: planning each document of a size split: its parts' paths checked, its lineage, its
// user writes, and the scan as it will read after them.

import {
  byteOffset,
  splitDocuments,
  type SplitDocument,
  type SplitPiece,
} from "./document-size-split-layout.js";
import { assertSafeAbsentDestination } from "./document-structure-split.js";
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
    copiedDefinitions: piece.appendix,
    linkRewrites: piece.rewrites,
  };
}

/** Every document's split planned in order, and what the plan defers or keeps whole. */
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
  splits: ReturnType<typeof splitDocuments<SplitSource>>;
}> {
  const { root, scan, policy, generatedPaths, sources, boundBytes } = input;
  const userConcept = input.registered;
  let virtualScan = scan;
  const planned: PlannedDocument[] = [];
  const deferred: DocumentSizeSplitPlan["deferred"] = [];
  const unsplittable: DocumentSizeSplitPlan["unsplittable"] = [];
  const splittable = sources.filter((source) => {
    if (source.data) return false;
    if (source.unread || userConcept(source.path)) return true;
    deferred.push({ path: source.path, byteCount: source.byteCount });
    return false;
  });
  const splits = splitDocuments(splittable, boundBytes);
  for (const { source, split } of splits) {
    if (typeof split === "string") {
      unsplittable.push({ path: source.path, byteCount: source.byteCount, reason: split });
      continue;
    }
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
  }
  return { virtualScan, planned, deferred, unsplittable, splits };
}
