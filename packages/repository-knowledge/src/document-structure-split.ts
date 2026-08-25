import { constants } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";
import { lstat, open } from "node:fs/promises";

import { parse } from "yaml";

import {
  createKnowledgeMigrationPlanForScan,
  recordedGeneratedKnowledgePaths,
  scanConfiguredRepositoryKnowledge,
} from "./compiler.js";
import {
  applyDurableKnowledgeOperations,
  type DurableKnowledgeUserFileOperation,
  type KnowledgeMaterializationCheckpoint,
} from "./durable-apply.js";
import { canonicalJson, sha256, stableId } from "./integrity.js";
import { splitMarkdownHeadingSubtree } from "./markdown-split.js";
import {
  repositoryPathCanRemainIncluded,
  repositorySourceKindForPath,
  splitRepositoryKnowledgeScanSource,
} from "./scanner.js";
import { createDocumentSplitLineage, normalizeKnowledgeDocumentPath } from "./source-lineage.js";
import { loadStoredConcepts } from "./store-reader.js";
import {
  RepositoryKnowledgeError,
  type KnowledgeFileOperation,
  type RepositoryKnowledgeScanOptions,
} from "./types.js";

export interface KnowledgeDocumentSplitPlan {
  schemaVersion: 1;
  planId: string;
  operationId: string;
  approvalHash: string;
  status: "review_required";
  projectId: string;
  repositoryRoot: string;
  sourceSnapshotId: string;
  afterSourceSnapshotId: string;
  policyHash: string;
  coverage: {
    included: number;
    excluded: number;
    unsupported: number;
    includedBytes: number;
    complete: boolean;
  };
  registryDigest: string;
  afterRegistryDigest: string;
  source: {
    path: string;
    beforeHash: string;
    afterHash: string;
    beforeByteCount: number;
    afterByteCount: number;
  };
  destination: { path: string; contentHash: string; byteCount: number };
  heading: { locator: string; title: string; depth: number; startByte: number; endByte: number };
  preservedConceptIds: string[];
  createdConceptIds: string[];
  updatedConceptIds: string[];
  deprecatedConceptIds: string[];
  lineageId: string;
  operations: Array<KnowledgeFileOperation | DurableKnowledgeUserFileOperation>;
}

export interface KnowledgeDocumentSplitReceipt {
  schemaVersion: 1;
  type: "knowledge.materialization.applied";
  operation: "document_structure_split";
  planId: string;
  operationId: string;
  projectId: string;
  sourceSnapshotId: string;
  afterSourceSnapshotId: string;
  approvalHash: string;
  sourcePathDigest: string;
  destinationPathDigest: string;
  sourceAfterHash: string;
  destinationHash: string;
  extractedByteCount: number;
  preservedConceptIds: string[];
  createdConceptIds: string[];
  lineageId: string;
  appliedAt: string;
}

const HASH = /^sha256:[a-f0-9]{64}$/;

async function safeHash(path: string): Promise<string> {
  let handle;
  try {
    handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const before = await handle.stat();
    if (!before.isFile() || before.size > 256 * 1024) throw new Error("unsafe sidecar");
    const bytes = await handle.readFile();
    const after = await handle.stat();
    if (
      before.dev !== after.dev ||
      before.ino !== after.ino ||
      before.size !== after.size ||
      before.mtimeMs !== after.mtimeMs ||
      bytes.byteLength !== before.size
    )
      throw new Error("sidecar changed");
    return sha256(bytes);
  } catch {
    throw new RepositoryKnowledgeError(
      "knowledge_reconciliation_conflict",
      "The knowledge registry cannot be read safely.",
    );
  } finally {
    await handle?.close();
  }
}

async function assertSafeAbsentDestination(root: string, path: string): Promise<void> {
  const child = relative(root, dirname(resolve(root, path)));
  let current = root;
  for (const segment of child.split(sep).filter(Boolean)) {
    current = resolve(current, segment);
    try {
      const stats = await lstat(current);
      if (!stats.isDirectory() || stats.isSymbolicLink())
        throw new RepositoryKnowledgeError(
          "knowledge_source_unsafe",
          "The split destination parent is not a safe physical directory.",
        );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") break;
      throw error;
    }
  }
  try {
    await lstat(resolve(root, path));
    throw new RepositoryKnowledgeError(
      "knowledge_reconciliation_conflict",
      "The split destination already exists.",
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

export function serializableKnowledgeDocumentSplitPlan(plan: KnowledgeDocumentSplitPlan): Omit<
  KnowledgeDocumentSplitPlan,
  "operations"
> & {
  operations: Array<Omit<KnowledgeFileOperation | DurableKnowledgeUserFileOperation, "content">>;
} {
  return {
    ...plan,
    operations: plan.operations.map(({ content: _content, ...operation }) => operation),
  };
}

export async function createKnowledgeDocumentSplitPlan(input: {
  repositoryRoot: string;
  sourcePath: string;
  destinationPath: string;
  headingLocator: string;
  supplementalSources?: RepositoryKnowledgeScanOptions["supplementalSources"];
}): Promise<KnowledgeDocumentSplitPlan> {
  const root = resolve(input.repositoryRoot);
  const sourcePath = normalizeKnowledgeDocumentPath(root, input.sourcePath);
  const destinationPath = normalizeKnowledgeDocumentPath(root, input.destinationPath);
  if (
    !sourcePath.endsWith(".md") ||
    !destinationPath.endsWith(".md") ||
    sourcePath === destinationPath
  ) {
    throw new RepositoryKnowledgeError(
      "knowledge_reconciliation_conflict",
      "The initial split profile supports only distinct CommonMark .md source and destination paths.",
    );
  }
  await assertSafeAbsentDestination(root, destinationPath);
  const [{ policy, scan }, storedConcepts, generatedPaths] = await Promise.all([
    scanConfiguredRepositoryKnowledge(
      root,
      input.supplementalSources === undefined
        ? {}
        : { supplementalSources: input.supplementalSources },
    ),
    loadStoredConcepts(root),
    recordedGeneratedKnowledgePaths(root),
  ]);
  const source = scan.sources.find((item) => item.path === sourcePath);
  if (
    source?.status !== "included" ||
    source.kind !== "documentation" ||
    source.contentHash === null ||
    source.content === undefined
  ) {
    throw new RepositoryKnowledgeError(
      "knowledge_reconciliation_conflict",
      "The split source must be a regular Markdown publication in the current snapshot.",
    );
  }
  if (
    repositorySourceKindForPath(destinationPath) !== "documentation" ||
    !repositoryPathCanRemainIncluded(destinationPath, policy) ||
    generatedPaths.has(destinationPath)
  ) {
    throw new RepositoryKnowledgeError(
      "knowledge_reconciliation_conflict",
      "The split destination must be a new regular Markdown path included by policy.",
    );
  }
  if (storedConcepts.some((item) => item.value === null))
    throw new RepositoryKnowledgeError(
      "knowledge_reconciliation_conflict",
      "The document cannot be split because the knowledge concept registry is incomplete.",
    );
  const related = storedConcepts.filter((item) => item.value?.path === sourcePath);
  if (
    related.length !== 1 ||
    related[0]!.value?.ownership !== "user" ||
    related[0]!.value?.publicationStatus === "deprecated"
  ) {
    throw new RepositoryKnowledgeError(
      "knowledge_reconciliation_conflict",
      "The split source must be registered as exactly one current user-owned concept.",
    );
  }
  const split = splitMarkdownHeadingSubtree(source.content, input.headingLocator);
  const sourceAfterHash = sha256(split.sourceContent);
  const destinationHash = sha256(split.destinationContent);
  if (
    Buffer.byteLength(split.sourceContent) + Buffer.byteLength(split.destinationContent) !==
    source.byteCount
  ) {
    throw new RepositoryKnowledgeError(
      "knowledge_unit_extraction_failed",
      "The split output does not match the source byte partition.",
    );
  }
  const sourceUnits = scan.units.filter((item) => item.sourceId === source.sourceId);
  if (sourceUnits.length < 1 || sourceUnits.length > 16384) {
    throw new RepositoryKnowledgeError(
      "knowledge_source_limit_exceeded",
      "The split source-unit count exceeds the lineage recording limit.",
    );
  }
  const operationId = stableId("kdocop", {
    projectId: scan.projectId,
    action: "split",
    sourceId: source.sourceId,
    sourcePath,
    destinationPath,
    sourceBeforeHash: source.contentHash,
    sourceAfterHash,
    destinationHash,
    headingLocator: split.locator,
    extractedRange: split.extractedRange,
  });
  const lineage = createDocumentSplitLineage({
    projectId: scan.projectId,
    operationId,
    sourcePath,
    destinationPath,
    identityPath: source.identityPath ?? source.path,
    sourceId: source.sourceId,
    sourceBeforeHash: source.contentHash,
    sourceBeforeByteCount: source.byteCount,
    sourceAfterHash,
    destinationHash,
    selectedHeadingLocator: split.locator,
    extractedRange: split.extractedRange,
    sourceUnitIds: sourceUnits.map((item) => item.unitId),
  });
  const virtualScan = splitRepositoryKnowledgeScanSource({
    scan,
    sourcePath,
    destinationPath,
    sourceContent: split.sourceContent,
    destinationContent: split.destinationContent,
  });
  const structural = await createKnowledgeMigrationPlanForScan({
    repositoryRoot: root,
    scan: virtualScan,
    mode: "refresh",
  });
  if (
    structural.status !== "ready" ||
    structural.operations.some((item) => item.action === "conflict")
  ) {
    throw new RepositoryKnowledgeError(
      "knowledge_reconciliation_conflict",
      "Generated publications cannot be updated safely after the split.",
    );
  }
  const lineageOperation: KnowledgeFileOperation = {
    path: lineage.file,
    action: "create",
    ownership: "lervo_generated",
    mediaType: "application/yaml",
    content: lineage.content,
    desiredHash: sha256(lineage.content),
  };
  const sourceOperation: DurableKnowledgeUserFileOperation = {
    path: sourcePath,
    action: "update",
    ownership: "user",
    mediaType: "text/markdown",
    content: split.sourceContent,
    expectedCurrentHash: source.contentHash,
    desiredHash: sourceAfterHash,
  };
  const destinationOperation: DurableKnowledgeUserFileOperation = {
    path: destinationPath,
    action: "create",
    ownership: "user",
    mediaType: "text/markdown",
    content: split.destinationContent,
    desiredHash: destinationHash,
  };
  const operations: Array<KnowledgeFileOperation | DurableKnowledgeUserFileOperation> = [
    ...structural.operations,
    lineageOperation,
    sourceOperation,
    destinationOperation,
  ];
  const registryMaterials = await Promise.all(
    storedConcepts.map(async (item) => ({
      file: item.file,
      contentHash: await safeHash(resolve(root, item.file)),
    })),
  );
  registryMaterials.sort((left, right) => left.file.localeCompare(right.file));
  const registryDigest = sha256(canonicalJson(registryMaterials));
  const conceptOperations = structural.operations.filter(
    (operation) =>
      operation.path.startsWith(".lervo/knowledge/concepts/") && operation.action !== "conflict",
  );
  const afterConceptHashes = new Map(
    registryMaterials.map((item) => [item.file, item.contentHash]),
  );
  for (const item of conceptOperations) afterConceptHashes.set(item.path, item.desiredHash);
  const afterRegistryDigest = sha256(
    canonicalJson(
      [...afterConceptHashes]
        .map(([file, contentHash]) => ({ file, contentHash }))
        .sort((left, right) => left.file.localeCompare(right.file)),
    ),
  );
  const conceptIdFor = (path: string): string =>
    path.slice(path.lastIndexOf("/") + 1, -".yaml".length);
  const createdConceptIds = conceptOperations
    .filter((item) => item.action === "create")
    .map((item) => conceptIdFor(item.path))
    .sort();
  const deprecatedConceptIds = conceptOperations
    .filter(
      (item) =>
        item.content !== undefined &&
        (parse(item.content) as { publicationStatus?: unknown }).publicationStatus === "deprecated",
    )
    .map((item) => conceptIdFor(item.path))
    .sort();
  const deprecatedSet = new Set(deprecatedConceptIds);
  const updatedConceptIds = conceptOperations
    .filter((item) => item.action === "update" && !deprecatedSet.has(conceptIdFor(item.path)))
    .map((item) => conceptIdFor(item.path))
    .sort();
  const operationBindings = operations.map(({ content: _content, ...operation }) => operation);
  const approvalHash = sha256(
    canonicalJson({
      operationId,
      action: "split_user_document",
      source: {
        path: sourcePath,
        beforeHash: source.contentHash,
        afterHash: sourceAfterHash,
        beforeByteCount: source.byteCount,
        afterByteCount: Buffer.byteLength(split.sourceContent),
      },
      destination: {
        path: destinationPath,
        contentHash: destinationHash,
        byteCount: Buffer.byteLength(split.destinationContent),
      },
      heading: { locator: split.locator, ...split.extractedRange },
      lineageId: lineage.value.lineageId,
      operations: operationBindings,
    }),
  );
  const policyHash = sha256(canonicalJson(policy));
  const materials = {
    projectId: scan.projectId,
    sourceSnapshotId: scan.snapshotId,
    afterSourceSnapshotId: virtualScan.snapshotId,
    policyHash,
    registryDigest,
    afterRegistryDigest,
    operationId,
    approvalHash,
    operations: operationBindings,
  };
  return {
    schemaVersion: 1,
    planId: stableId("kstruct", materials),
    operationId,
    approvalHash,
    status: "review_required",
    projectId: scan.projectId,
    repositoryRoot: root,
    sourceSnapshotId: scan.snapshotId,
    afterSourceSnapshotId: virtualScan.snapshotId,
    policyHash,
    coverage: scan.coverage,
    registryDigest,
    afterRegistryDigest,
    source: {
      path: sourcePath,
      beforeHash: source.contentHash,
      afterHash: sourceAfterHash,
      beforeByteCount: source.byteCount,
      afterByteCount: Buffer.byteLength(split.sourceContent),
    },
    destination: {
      path: destinationPath,
      contentHash: destinationHash,
      byteCount: Buffer.byteLength(split.destinationContent),
    },
    heading: {
      locator: split.locator,
      title: split.title,
      depth: split.depth,
      startByte: split.extractedRange.startByte,
      endByte: split.extractedRange.endByte,
    },
    preservedConceptIds: [related[0]!.value!.conceptId],
    createdConceptIds,
    updatedConceptIds,
    deprecatedConceptIds,
    lineageId: lineage.value.lineageId,
    operations,
  };
}

export async function applyKnowledgeDocumentSplitPlan(input: {
  plan: KnowledgeDocumentSplitPlan;
  approvedOperationId: string;
  approvedHash: string;
  now: Date;
  recordApplied: (receipt: KnowledgeDocumentSplitReceipt) => void | Promise<void>;
  supplementalSources?: RepositoryKnowledgeScanOptions["supplementalSources"];
  failureInjector?: (
    checkpoint: KnowledgeMaterializationCheckpoint,
  ) => "interrupt" | void | Promise<"interrupt" | void>;
}): Promise<KnowledgeDocumentSplitReceipt> {
  if (
    input.approvedOperationId !== input.plan.operationId ||
    !HASH.test(input.approvedHash) ||
    input.approvedHash !== input.plan.approvalHash
  ) {
    throw new RepositoryKnowledgeError(
      "knowledge_approval_required",
      "A document split requires an operation ID and exact approval hash.",
    );
  }
  const current = await createKnowledgeDocumentSplitPlan({
    repositoryRoot: input.plan.repositoryRoot,
    sourcePath: input.plan.source.path,
    destinationPath: input.plan.destination.path,
    headingLocator: input.plan.heading.locator,
    ...(input.supplementalSources === undefined
      ? {}
      : { supplementalSources: input.supplementalSources }),
  });
  if (current.planId !== input.plan.planId)
    throw new RepositoryKnowledgeError(
      "knowledge_plan_stale",
      "The document, destination, heading, registry, policy, or source snapshot changed after the split was planned.",
    );
  const receipt: KnowledgeDocumentSplitReceipt = {
    schemaVersion: 1,
    type: "knowledge.materialization.applied",
    operation: "document_structure_split",
    planId: current.planId,
    operationId: current.operationId,
    projectId: current.projectId,
    sourceSnapshotId: current.sourceSnapshotId,
    afterSourceSnapshotId: current.afterSourceSnapshotId,
    approvalHash: current.approvalHash,
    sourcePathDigest: sha256(current.source.path),
    destinationPathDigest: sha256(current.destination.path),
    sourceAfterHash: current.source.afterHash,
    destinationHash: current.destination.contentHash,
    extractedByteCount: current.destination.byteCount,
    preservedConceptIds: current.preservedConceptIds,
    createdConceptIds: current.createdConceptIds,
    lineageId: current.lineageId,
    appliedAt: input.now.toISOString(),
  };
  return applyDurableKnowledgeOperations({
    repositoryRoot: current.repositoryRoot,
    projectId: current.projectId,
    planId: current.planId,
    operations: current.operations,
    receipt,
    recordApplied: input.recordApplied,
    ...(input.failureInjector === undefined ? {} : { failureInjector: input.failureInjector }),
  });
}
