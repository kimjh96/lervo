import { constants } from "node:fs";
import { lstat, open } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";

import { parse } from "yaml";

import { canonicalJson, sha256, stableId } from "./integrity.js";
import { normalizationRecordMoveOperations } from "./document-normalization-record-move.js";
import {
  applyDurableKnowledgeOperations,
  type DurableKnowledgeMoveOperation,
  type DurableKnowledgeUserFileOperation,
  type KnowledgeMaterializationCheckpoint,
} from "./durable-apply.js";
import { authorizeCurrentRepositoryDocumentLayout } from "./document-layout-enforcement.js";
import { isWithinPublicationRoot } from "./repository-publication-files.js";
import {
  createKnowledgeMigrationPlanForScan,
  recordedGeneratedKnowledgePaths,
  scanCompleteConfiguredRepositoryKnowledge,
} from "./compiler.js";
import {
  relocateRepositoryKnowledgeScanSource,
  repositoryPathCanRemainIncluded,
  repositorySourceKindForPath,
} from "./scanner.js";
import { createDocumentMoveLineage, normalizeKnowledgeDocumentPath } from "./source-lineage.js";
import { loadStoredConcepts } from "./store-reader.js";
import { structuralConceptDirectory } from "./structural-projection.js";
import {
  RepositoryKnowledgeError,
  type KnowledgeFileOperation,
  type RepositoryKnowledgeScanOptions,
} from "./types.js";

export interface KnowledgeDocumentMovePlan {
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
  document: { fromPath: string; toPath: string; contentHash: string; byteCount: number };
  preservedConceptIds: string[];
  createdConceptIds: string[];
  updatedConceptIds: string[];
  deprecatedConceptIds: string[];
  lineageId: string;
  relocatedNormalizationRecords: string[];
  operations: Array<
    KnowledgeFileOperation | DurableKnowledgeMoveOperation | DurableKnowledgeUserFileOperation
  >;
}

export interface KnowledgeDocumentMoveReceipt {
  schemaVersion: 1;
  type: "knowledge.materialization.applied";
  operation: "document_structure_move";
  planId: string;
  operationId: string;
  projectId: string;
  sourceSnapshotId: string;
  afterSourceSnapshotId: string;
  approvalHash: string;
  fromPathDigest: string;
  toPathDigest: string;
  preservedConceptIds: string[];
  lineageId: string;
  relocatedNormalizationRecords: string[];
  updatedKnowledgeFiles: string[];
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

async function assertDestinationAbsent(path: string): Promise<void> {
  try {
    await lstat(path);
    throw new RepositoryKnowledgeError(
      "knowledge_reconciliation_conflict",
      "The document move destination already exists.",
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
}

async function assertSafeDestinationParents(root: string, path: string): Promise<void> {
  const child = relative(root, dirname(resolve(root, path)));
  let current = root;
  for (const segment of child.split(sep).filter(Boolean)) {
    current = resolve(current, segment);
    try {
      const stats = await lstat(current);
      if (!stats.isDirectory() || stats.isSymbolicLink())
        throw new RepositoryKnowledgeError(
          "knowledge_source_unsafe",
          "The move destination parent is not a safe physical directory.",
        );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
  }
}

export function serializableKnowledgeDocumentMovePlan(plan: KnowledgeDocumentMovePlan): Omit<
  KnowledgeDocumentMovePlan,
  "operations"
> & {
  operations: Array<
    | Omit<KnowledgeFileOperation, "content">
    | Omit<DurableKnowledgeUserFileOperation, "content">
    | DurableKnowledgeMoveOperation
  >;
} {
  return {
    ...plan,
    operations: plan.operations.map((operation) =>
      operation.action === "move"
        ? operation
        : (({ content: _content, ...item }) => item)(operation),
    ),
  };
}

export async function createKnowledgeDocumentMovePlan(input: {
  repositoryRoot: string;
  fromPath: string;
  toPath: string;
  supplementalSources?: RepositoryKnowledgeScanOptions["supplementalSources"];
}): Promise<KnowledgeDocumentMovePlan> {
  const root = resolve(input.repositoryRoot);
  const fromPath = normalizeKnowledgeDocumentPath(root, input.fromPath);
  const toPath = normalizeKnowledgeDocumentPath(root, input.toPath);
  if (fromPath === toPath)
    throw new RepositoryKnowledgeError(
      "knowledge_reconciliation_conflict",
      "The document move source and destination are identical.",
    );
  await assertSafeDestinationParents(root, toPath);
  await assertDestinationAbsent(resolve(root, toPath));
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
  const source = scan.sources.find((item) => item.path === fromPath);
  if (
    source?.status !== "included" ||
    source.contentHash === null ||
    source.content === undefined ||
    (source.kind !== "documentation" && source.kind !== "instruction")
  ) {
    throw new RepositoryKnowledgeError(
      "knowledge_reconciliation_conflict",
      "The move source must be a regular Markdown document in the current snapshot.",
    );
  }
  if (repositorySourceKindForPath(toPath) !== source.kind) {
    throw new RepositoryKnowledgeError(
      "knowledge_reconciliation_conflict",
      "A move across the instruction-bridge boundary requires a separate review contract.",
    );
  }
  if (!repositoryPathCanRemainIncluded(toPath, policy)) {
    throw new RepositoryKnowledgeError(
      "knowledge_reconciliation_conflict",
      "The move destination must be included by the current knowledge scan policy.",
    );
  }
  if (generatedPaths.has(toPath)) {
    throw new RepositoryKnowledgeError(
      "knowledge_reconciliation_conflict",
      "The move destination cannot be a previous Lervo-generated output path.",
    );
  }
  if (isWithinPublicationRoot(toPath, policy.publicationRoot)) {
    throw new RepositoryKnowledgeError(
      "knowledge_reconciliation_conflict",
      "The move destination cannot be inside the Git-ignored generated publication root.",
    );
  }
  if (storedConcepts.some((item) => item.value === null)) {
    throw new RepositoryKnowledgeError(
      "knowledge_reconciliation_conflict",
      "The document cannot be moved because the knowledge concept registry is incomplete.",
    );
  }
  const related = storedConcepts.filter((item) => item.value?.path === fromPath);
  if (
    related.length !== 1 ||
    related[0]!.value?.ownership !== "user" ||
    related[0]!.value?.publicationStatus === "deprecated"
  ) {
    throw new RepositoryKnowledgeError(
      "knowledge_reconciliation_conflict",
      "The move source must be registered as exactly one current user-owned concept.",
    );
  }
  const sourceUnits = scan.units.filter((item) => item.sourceId === source.sourceId);
  if (sourceUnits.length < 1 || sourceUnits.length > 16384) {
    throw new RepositoryKnowledgeError(
      "knowledge_source_limit_exceeded",
      "The move source-unit count is outside the allowed range.",
    );
  }
  const identityPath = source.identityPath ?? source.path;
  const operationId = stableId("kdocop", {
    projectId: scan.projectId,
    action: "move",
    sourceId: source.sourceId,
    fromPath,
    toPath,
    contentHash: source.contentHash,
    conceptId: related[0]!.value!.conceptId,
    sourceUnitIds: sourceUnits.map((item) => item.unitId).sort(),
  });
  const lineage = createDocumentMoveLineage({
    projectId: scan.projectId,
    operationId,
    fromPath,
    toPath,
    identityPath,
    sourceId: source.sourceId,
    sourceContentHash: source.contentHash,
    sourceUnitIds: sourceUnits.map((item) => item.unitId),
  });
  const virtualScan = relocateRepositoryKnowledgeScanSource({ scan, fromPath, toPath });
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
      "Generated publications cannot be updated safely after the move.",
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
  const moveOperation: DurableKnowledgeMoveOperation = {
    path: fromPath,
    destinationPath: toPath,
    action: "move",
    expectedCurrentHash: source.contentHash,
  };
  const normalizationRecords = await normalizationRecordMoveOperations(root, fromPath, toPath);
  const operations: Array<
    KnowledgeFileOperation | DurableKnowledgeMoveOperation | DurableKnowledgeUserFileOperation
  > = [
    ...structural.operations,
    lineageOperation,
    ...normalizationRecords.operations,
    moveOperation,
  ];
  const registryMaterials = await Promise.all(
    storedConcepts.map(async (item) => ({
      file: item.file,
      contentHash: await safeHash(resolve(root, item.file)),
    })),
  );
  registryMaterials.sort((left, right) => left.file.localeCompare(right.file));
  const registryDigest = sha256(canonicalJson(registryMaterials));
  const afterConceptHashes = new Map(
    registryMaterials.map((item) => [item.file, item.contentHash]),
  );
  const conceptOperations = structural.operations.filter(
    (operation) =>
      operation.path.startsWith(`${structuralConceptDirectory}/`) &&
      operation.action !== "conflict",
  );
  for (const item of conceptOperations) {
    afterConceptHashes.set(item.path, item.desiredHash);
  }
  const conceptIdFor = (path: string): string =>
    path.slice(path.lastIndexOf("/") + 1, -".yaml".length);
  const createdConceptIds = conceptOperations
    .filter((item) => item.action === "create")
    .map((item) => conceptIdFor(item.path))
    .sort();
  const deprecatedConceptIds = conceptOperations
    .filter((item) => {
      if (item.content === undefined) return false;
      return (
        (parse(item.content) as { publicationStatus?: unknown }).publicationStatus === "deprecated"
      );
    })
    .map((item) => conceptIdFor(item.path))
    .sort();
  const deprecatedConceptIdSet = new Set(deprecatedConceptIds);
  const updatedConceptIds = conceptOperations
    .filter(
      (item) => item.action === "update" && !deprecatedConceptIdSet.has(conceptIdFor(item.path)),
    )
    .map((item) => conceptIdFor(item.path))
    .sort();
  const afterRegistryDigest = sha256(
    canonicalJson(
      [...afterConceptHashes]
        .map(([file, contentHash]) => ({ file, contentHash }))
        .sort((left, right) => left.file.localeCompare(right.file)),
    ),
  );
  const operationBindings = operations.map((operation) =>
    operation.action === "move" ? operation : (({ content: _content, ...item }) => item)(operation),
  );
  const approvalHash = sha256(
    canonicalJson({
      operationId,
      action: "move_user_document",
      source: { path: fromPath, contentHash: source.contentHash, byteCount: source.byteCount },
      destination: { path: toPath },
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
  const plan: KnowledgeDocumentMovePlan = {
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
    coverage: scan.inventoryCoverage,
    registryDigest,
    afterRegistryDigest,
    document: { fromPath, toPath, contentHash: source.contentHash, byteCount: source.byteCount },
    preservedConceptIds: [related[0]!.value!.conceptId],
    createdConceptIds,
    updatedConceptIds,
    deprecatedConceptIds,
    lineageId: lineage.value.lineageId,
    relocatedNormalizationRecords: normalizationRecords.paths,
    operations,
  };
  await authorizeCurrentRepositoryDocumentLayout({ repositoryRoot: root, operations });
  return plan;
}

export async function applyKnowledgeDocumentMovePlan(input: {
  plan: KnowledgeDocumentMovePlan;
  approvedOperationId: string;
  approvedHash: string;
  now: Date;
  recordApplied: (receipt: KnowledgeDocumentMoveReceipt) => void | Promise<void>;
  supplementalSources?: RepositoryKnowledgeScanOptions["supplementalSources"];
  failureInjector?: (
    checkpoint: KnowledgeMaterializationCheckpoint,
  ) => "interrupt" | void | Promise<"interrupt" | void>;
}): Promise<KnowledgeDocumentMoveReceipt> {
  if (
    input.approvedOperationId !== input.plan.operationId ||
    !HASH.test(input.approvedHash) ||
    input.approvedHash !== input.plan.approvalHash
  ) {
    throw new RepositoryKnowledgeError(
      "knowledge_approval_required",
      "A document move requires an operation ID and exact approval hash.",
    );
  }
  const current = await createKnowledgeDocumentMovePlan({
    repositoryRoot: input.plan.repositoryRoot,
    fromPath: input.plan.document.fromPath,
    toPath: input.plan.document.toPath,
    ...(input.supplementalSources === undefined
      ? {}
      : { supplementalSources: input.supplementalSources }),
  });
  if (current.planId !== input.plan.planId)
    throw new RepositoryKnowledgeError(
      "knowledge_plan_stale",
      "The document, destination, registry, policy, or source snapshot changed after the move was planned.",
    );
  const receipt: KnowledgeDocumentMoveReceipt = {
    schemaVersion: 1,
    type: "knowledge.materialization.applied",
    operation: "document_structure_move",
    planId: current.planId,
    operationId: current.operationId,
    projectId: current.projectId,
    sourceSnapshotId: current.sourceSnapshotId,
    afterSourceSnapshotId: current.afterSourceSnapshotId,
    approvalHash: current.approvalHash,
    fromPathDigest: sha256(current.document.fromPath),
    toPathDigest: sha256(current.document.toPath),
    preservedConceptIds: current.preservedConceptIds,
    lineageId: current.lineageId,
    relocatedNormalizationRecords: current.relocatedNormalizationRecords,
    updatedKnowledgeFiles: current.operations
      .filter((item) => item.action === "create" || item.action === "update")
      .map((item) => item.path),
    appliedAt: input.now.toISOString(),
  };
  return applyDurableKnowledgeOperations({
    repositoryRoot: current.repositoryRoot,
    projectId: current.projectId,
    planId: current.planId,
    operations: current.operations,
    documentLayoutPermit: await authorizeCurrentRepositoryDocumentLayout({
      repositoryRoot: current.repositoryRoot,
      operations: current.operations,
    }),
    receipt,
    recordApplied: input.recordApplied,
    ...(input.failureInjector === undefined ? {} : { failureInjector: input.failureInjector }),
  });
}
