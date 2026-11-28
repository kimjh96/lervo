// ADR-0653: a document too large to normalize in one pass is split mechanically into parts beside
// it before normalization. Each part is an original byte range plus recorded changes: rebased and
// heading-following links, repeated table header rows, and copied reference definitions. The
// check undoes them and compares every written file with its range.
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  createKnowledgeMigrationPlanForScan,
  recordedGeneratedKnowledgePaths,
  scanCompleteConfiguredRepositoryKnowledge,
} from "./compiler.js";
import { authorizeCurrentRepositoryDocumentLayout } from "./document-layout-enforcement.js";
import { DOCUMENT_SINGLE_PASS_BYTES } from "./document-size-partition.js";
import {
  splitReferenceUpdates,
  type SplitReferenceUpdate,
} from "./document-size-split-references.js";
import { referenceUpdateRestores } from "./document-size-split-verify.js";
import type { DurableKnowledgeUserFileOperation } from "./durable-apply.js";
import type { DocumentSizeSplitPlan } from "./document-size-split-contract.js";
import { canonicalJson, sha256, stableId } from "./integrity.js";
import { upsertRepositoryKnowledgeScanSources } from "./scanner.js";
import { loadStoredConcepts } from "./store-reader.js";
import { planSplits } from "./document-size-split-documents.js";
import {
  registryChange,
  requestedDocuments,
  unreadDocuments,
} from "./document-size-split-sources.js";
import { RepositoryKnowledgeError, type RepositoryKnowledgeScanOptions } from "./types.js";

/**
 * Each linking document checked as the cross-check will check it: one whose written text would
 * not restore to its current bytes is left unchanged, and its rewritten links are named as not
 * kept, so it never fails the plan.
 */
async function checkedReferences(
  root: string,
  references: SplitReferenceUpdate[],
): Promise<SplitReferenceUpdate[]> {
  const checked: SplitReferenceUpdate[] = [];
  for (const reference of references) {
    const current = (await readFile(resolve(root, reference.path))).toString("utf8");
    checked.push(
      reference.linkRewrites.length === 0 ||
        referenceUpdateRestores(
          current,
          reference.beforeHash,
          reference.content,
          reference.linkRewrites,
        )
        ? reference
        : {
            ...reference,
            afterHash: reference.beforeHash,
            linkRewrites: [],
            unkeptLinks: [
              ...reference.unkeptLinks,
              ...reference.linkRewrites.map((rewrite) => rewrite.before),
            ],
          },
    );
  }
  return checked;
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
  const splitting = await planSplits({
    root,
    scan,
    policy,
    generatedPaths,
    sources,
    boundBytes,
    registered: userConcept,
  });
  let virtualScan = splitting.virtualScan;
  const { planned, deferred, unsplittable, failed } = splitting;
  const linked = await checkedReferences(
    root,
    splitReferenceUpdates(scan, splitting.anchors, splitting.writes),
  );
  const references = linked.filter((reference) => reference.linkRewrites.length > 0);
  if (references.length > 0)
    virtualScan = upsertRepositoryKnowledgeScanSources(
      virtualScan,
      references.map((reference) => ({ path: reference.path, content: reference.content })),
    );
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
    ...references.map((reference): DurableKnowledgeUserFileOperation => ({
      path: reference.path,
      action: "update",
      ownership: "user",
      mediaType: "text/markdown",
      content: reference.content,
      expectedCurrentHash: reference.beforeHash,
      desiredHash: reference.afterHash,
    })),
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
      references: references.map((reference) => [reference.path, reference.afterHash]),
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
    status: documents.length === 0 && references.length === 0 ? "current" : "review_required",
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
    failed,
    referenceUpdates: references.map(({ content: _content, ...reference }) => reference),
    unkeptReferences: linked.flatMap((reference) =>
      reference.unkeptLinks.map((url) => ({ path: reference.path, url })),
    ),
    unsplittable: [...unsplittable, ...planned.flatMap((item) => item.unsplittable)],
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
