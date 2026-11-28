// ADR-0653: a document too large to normalize in one pass is split, mechanically and byte for
// byte, into parts beside it before normalization. The plan is a pure function of the document's
// bytes, so its check is deterministic: the parts' original ranges reassemble the document
// exactly, and planning again from the same bytes yields the same plan.
import { resolve } from "node:path";

import {
  createKnowledgeMigrationPlanForScan,
  recordedGeneratedKnowledgePaths,
  scanCompleteConfiguredRepositoryKnowledge,
} from "./compiler.js";
import { authorizeCurrentRepositoryDocumentLayout } from "./document-layout-enforcement.js";
import { DOCUMENT_SINGLE_PASS_BYTES } from "./document-size-partition.js";
import { byteOffset, splitOversizedDocument } from "./document-size-split-layout.js";
import { assertSafeAbsentDestination } from "./document-structure-split.js";
import type { DurableKnowledgeUserFileOperation } from "./durable-apply.js";
import type {
  DocumentSizeSplitDocument,
  DocumentSizeSplitPlan,
} from "./document-size-split-contract.js";
import { canonicalJson, sha256, stableId } from "./integrity.js";
import { isWithinPublicationRoot } from "./repository-publication-files.js";
import {
  repositoryPathCanRemainIncluded,
  splitRepositoryKnowledgeScanSource,
  upsertRepositoryKnowledgeScanSources,
} from "./scanner.js";
import { createDocumentSplitLineage } from "./source-lineage.js";
import { loadStoredConcepts } from "./store-reader.js";
import {
  registryChange,
  requestedDocuments,
  unreadDocuments,
  type ScannedPolicy,
  type SplitSource,
} from "./document-size-split-sources.js";
import {
  RepositoryKnowledgeError,
  type KnowledgeFileOperation,
  type RepositoryKnowledgeScan,
  type RepositoryKnowledgeScanOptions,
} from "./types.js";

interface PlannedDocument {
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
  boundBytes: number;
}): Promise<PlannedDocument> {
  const { source, scan } = input;
  const split = splitOversizedDocument(source.path, source.content, input.boundBytes);
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
  const afterHash = sha256(split.index);
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
      afterByteCount: Buffer.byteLength(split.index),
      parts: [],
    },
    scan: input.virtualScan,
    lineageOperations: [],
    userOperations: [],
    lineageIds: [],
    unsplittable: [],
  };
  for (const part of split.parts) {
    const range = {
      startByte: byteOffset(source.content, part.part.start),
      endByte: byteOffset(source.content, part.part.end),
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
        sourceContent: split.index,
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
    if (part.part.oversized) planned.unsplittable.push({ path: part.path, byteCount });
    planned.document.parts.push({
      path: part.path,
      title: part.part.title,
      ...range,
      contentHash,
      byteCount,
      repeatedHeaderBytes: Buffer.byteLength(part.part.repeatedHeader ?? ""),
      rebasedLinks: part.rebased,
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
        { path: source.path, content: split.index },
        ...split.parts.map((part) => ({ path: part.path, content: part.content })),
      ],
    );
  planned.userOperations.push({
    path: source.path,
    action: "update",
    ownership: "user",
    mediaType: "text/markdown",
    content: split.index,
    expectedCurrentHash: source.contentHash,
    desiredHash: afterHash,
  });
  return planned;
}

/**
 * Plans the split of every given document over the single-pass bound, in one exact plan. Documents
 * over the split maximum are reported as data; the plan is `current` when nothing needs a split.
 */
export async function createDocumentSizeSplitPlan(input: {
  repositoryRoot: string;
  sourcePaths: readonly string[];
  boundBytes?: number;
  supplementalSources?: RepositoryKnowledgeScanOptions["supplementalSources"];
}): Promise<DocumentSizeSplitPlan> {
  const root = resolve(input.repositoryRoot);
  const boundBytes = input.boundBytes ?? DOCUMENT_SINGLE_PASS_BYTES;
  const [{ policy, scan }, storedConcepts, generatedPaths] = await Promise.all([
    scanCompleteConfiguredRepositoryKnowledge(
      root,
      input.supplementalSources === undefined
        ? {}
        : { supplementalSources: input.supplementalSources },
    ),
    loadStoredConcepts(root),
    recordedGeneratedKnowledgePaths(root),
  ]);
  if (storedConcepts.some((item) => item.value === null))
    throw new RepositoryKnowledgeError(
      "knowledge_reconciliation_conflict",
      "Documents cannot be split because the knowledge concept registry is incomplete.",
    );
  const requested = requestedDocuments(scan, input.sourcePaths, boundBytes);
  const sources = [
    ...requested,
    ...(await unreadDocuments(root, scan, policy, generatedPaths, requested)),
  ].sort((left, right) => left.path.localeCompare(right.path));
  const userConcept = (path: string) =>
    storedConcepts.filter(
      (item) =>
        item.value?.path === path &&
        item.value.ownership === "user" &&
        item.value.publicationStatus !== "deprecated",
    ).length === 1;
  let virtualScan = scan;
  const planned: PlannedDocument[] = [];
  const deferred: DocumentSizeSplitPlan["deferred"] = [];
  for (const source of sources) {
    if (source.data) continue;
    if (!source.unread && !userConcept(source.path)) {
      deferred.push({ path: source.path, byteCount: source.byteCount });
      continue;
    }
    const document = await planDocument({
      root,
      scan,
      virtualScan,
      policy,
      generatedPaths,
      source,
      boundBytes,
    });
    virtualScan = document.scan;
    planned.push(document);
  }
  const structural =
    planned.length === 0
      ? { status: "ready" as const, operations: [] }
      : await createKnowledgeMigrationPlanForScan({
          repositoryRoot: root,
          scan: virtualScan,
          mode: "refresh",
        });
  if (
    structural.status !== "ready" ||
    structural.operations.some((item) => item.action === "conflict")
  )
    throw new RepositoryKnowledgeError(
      "knowledge_reconciliation_conflict",
      "Generated publications cannot be updated safely after the document split.",
    );
  const operations: DocumentSizeSplitPlan["operations"] = [
    ...structural.operations,
    ...planned.flatMap((item) => item.lineageOperations),
    ...planned.flatMap((item) => item.userOperations),
  ];
  const registry = await registryChange(root, storedConcepts, structural.operations);
  const documents = planned.map((item) => item.document);
  const operationId = stableId("kdocop", {
    projectId: scan.projectId,
    action: "size_split_plan",
    documents: documents.map((document) => [document.path, document.afterHash]),
  });
  const approvalHash = sha256(
    canonicalJson({
      operationId,
      boundBytes,
      documents,
      operations: operations.map(({ content: _content, ...operation }) => operation),
    }),
  );
  const policyHash = sha256(canonicalJson(policy));
  const plan: DocumentSizeSplitPlan = {
    schemaVersion: 1,
    planKind: "document_size_split",
    planId: stableId("kstruct", {
      projectId: scan.projectId,
      sourceSnapshotId: scan.snapshotId,
      afterSourceSnapshotId: virtualScan.snapshotId,
      policyHash,
      registryDigest: registry.registryDigest,
      afterRegistryDigest: registry.afterRegistryDigest,
      operationId,
      approvalHash,
    }),
    operationId,
    approvalHash,
    status: documents.length === 0 ? "current" : "review_required",
    projectId: scan.projectId,
    repositoryRoot: root,
    sourceSnapshotId: scan.snapshotId,
    afterSourceSnapshotId: virtualScan.snapshotId,
    policyHash,
    coverage: scan.inventoryCoverage,
    registryDigest: registry.registryDigest,
    afterRegistryDigest: registry.afterRegistryDigest,
    boundBytes,
    documents,
    unsplittable: planned.flatMap((item) => item.unsplittable),
    data: sources
      .filter((source) => source.data)
      .map((source) => ({ path: source.path, byteCount: source.byteCount })),
    deferred,
    createdConceptIds: registry.created,
    updatedConceptIds: registry.updated,
    deprecatedConceptIds: registry.deprecated,
    lineageIds: planned.flatMap((item) => item.lineageIds),
    operations,
  };
  if (documents.length > 0)
    await authorizeCurrentRepositoryDocumentLayout({ repositoryRoot: root, operations });
  return plan;
}
