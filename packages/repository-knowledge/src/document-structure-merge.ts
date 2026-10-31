import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { resolve } from "node:path";

import { parse, stringify } from "yaml";

import {
  createKnowledgeMigrationPlanForScan,
  scanCompleteConfiguredRepositoryKnowledge,
} from "./compiler.js";
import {
  applyDurableKnowledgeOperations,
  type DurableKnowledgeDeleteOperation,
  type DurableKnowledgeUserFileOperation,
  type KnowledgeMaterializationCheckpoint,
} from "./durable-apply.js";
import { authorizeCurrentRepositoryDocumentLayout } from "./document-layout-enforcement.js";
import { canonicalJson, sha256, stableId } from "./integrity.js";
import { mergeRepositoryKnowledgeScanSources } from "./scanner.js";
import {
  createDocumentMergeLineage,
  loadDocumentMoveLineages,
  normalizeKnowledgeDocumentPath,
} from "./source-lineage.js";
import { loadStoredConcepts } from "./store-reader.js";
import { structuralConceptDirectory } from "./structural-projection.js";
import {
  RepositoryKnowledgeError,
  type KnowledgeFileOperation,
  type RepositoryKnowledgeScanOptions,
} from "./types.js";

export interface KnowledgeDocumentMergePlan {
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
  source: { path: string; contentHash: string; byteCount: number; conceptId: string };
  destination: {
    path: string;
    beforeHash: string;
    afterHash: string;
    beforeByteCount: number;
    afterByteCount: number;
    conceptId: string;
  };
  composition: "destination_then_source";
  preservedConceptIds: string[];
  createdConceptIds: string[];
  updatedConceptIds: string[];
  deprecatedConceptIds: string[];
  lineageId: string;
  operations: Array<
    KnowledgeFileOperation | DurableKnowledgeUserFileOperation | DurableKnowledgeDeleteOperation
  >;
}

export interface KnowledgeDocumentMergeReceipt {
  schemaVersion: 1;
  type: "knowledge.materialization.applied";
  operation: "document_structure_merge";
  planId: string;
  operationId: string;
  projectId: string;
  sourceSnapshotId: string;
  afterSourceSnapshotId: string;
  approvalHash: string;
  sourcePathDigest: string;
  destinationPathDigest: string;
  destinationAfterHash: string;
  mergedByteCount: number;
  preservedConceptIds: string[];
  deprecatedConceptIds: string[];
  lineageId: string;
  appliedAt: string;
}

const HASH = /^sha256:[a-f0-9]{64}$/;

async function safeSidecar(
  path: string,
): Promise<{ bytes: Buffer; value: Record<string, unknown> }> {
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
    const value = parse(bytes.toString("utf8")) as Record<string, unknown> | null;
    if (value === null || typeof value !== "object" || Array.isArray(value))
      throw new Error("invalid sidecar");
    return { bytes, value };
  } catch {
    throw new RepositoryKnowledgeError(
      "knowledge_reconciliation_conflict",
      "The knowledge registry cannot be read safely.",
    );
  } finally {
    await handle?.close();
  }
}

export function serializableKnowledgeDocumentMergePlan(plan: KnowledgeDocumentMergePlan): Omit<
  KnowledgeDocumentMergePlan,
  "operations"
> & {
  operations: Array<
    | Omit<KnowledgeFileOperation | DurableKnowledgeUserFileOperation, "content">
    | DurableKnowledgeDeleteOperation
  >;
} {
  return {
    ...plan,
    operations: plan.operations.map((operation) =>
      operation.action === "delete"
        ? operation
        : (({ content: _content, ...item }) => item)(operation),
    ),
  };
}

export async function createKnowledgeDocumentMergePlan(input: {
  repositoryRoot: string;
  sourcePath: string;
  destinationPath: string;
  supplementalSources?: RepositoryKnowledgeScanOptions["supplementalSources"];
}): Promise<KnowledgeDocumentMergePlan> {
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
      "The initial merge profile supports only distinct CommonMark .md source and destination paths.",
    );
  }
  const [{ policy, scan }, storedConcepts] = await Promise.all([
    scanCompleteConfiguredRepositoryKnowledge(
      root,
      input.supplementalSources === undefined
        ? {}
        : { supplementalSources: input.supplementalSources },
    ),
    loadStoredConcepts(root),
  ]);
  const source = scan.sources.find((item) => item.path === sourcePath);
  const destination = scan.sources.find((item) => item.path === destinationPath);
  if (
    source?.status !== "included" ||
    source.kind !== "documentation" ||
    source.contentHash === null ||
    source.content === undefined ||
    destination?.status !== "included" ||
    destination.kind !== "documentation" ||
    destination.contentHash === null ||
    destination.content === undefined
  )
    throw new RepositoryKnowledgeError(
      "knowledge_reconciliation_conflict",
      "The merge source and destination must be regular Markdown publications in the current snapshot.",
    );
  if (!destination.content.endsWith("\n")) {
    throw new RepositoryKnowledgeError(
      "knowledge_reconciliation_conflict",
      "The exact merge destination must end with a newline to form a safe Markdown boundary with the source.",
    );
  }
  if (storedConcepts.some((item) => item.value === null))
    throw new RepositoryKnowledgeError(
      "knowledge_reconciliation_conflict",
      "The documents cannot be merged because the knowledge concept registry is incomplete.",
    );
  const sourceRelated = storedConcepts.filter((item) => item.value?.path === sourcePath);
  const destinationRelated = storedConcepts.filter((item) => item.value?.path === destinationPath);
  if (
    sourceRelated.length !== 1 ||
    destinationRelated.length !== 1 ||
    sourceRelated[0]!.value?.ownership !== "user" ||
    destinationRelated[0]!.value?.ownership !== "user" ||
    sourceRelated[0]!.value?.publicationStatus === "deprecated" ||
    destinationRelated[0]!.value?.publicationStatus === "deprecated"
  )
    throw new RepositoryKnowledgeError(
      "knowledge_reconciliation_conflict",
      "The merge source and destination must each be registered as exactly one current user-owned concept.",
    );
  const destinationContent = destination.content + source.content;
  const destinationAfterHash = sha256(destinationContent);
  const destinationAfterByteCount = Buffer.byteLength(destinationContent);
  if (
    destinationAfterByteCount !== destination.byteCount + source.byteCount ||
    destinationAfterByteCount > policy.limits.maxFileBytes
  ) {
    throw new RepositoryKnowledgeError(
      "knowledge_source_limit_exceeded",
      "The merge output does not satisfy exact byte composition or the file-size limit.",
    );
  }
  const sourceUnits = scan.units.filter((item) => item.sourceId === source.sourceId);
  const destinationUnits = scan.units.filter((item) => item.sourceId === destination.sourceId);
  if (
    sourceUnits.length < 1 ||
    sourceUnits.length > 16384 ||
    destinationUnits.length < 1 ||
    destinationUnits.length > 16384
  ) {
    throw new RepositoryKnowledgeError(
      "knowledge_source_limit_exceeded",
      "The merge source-unit count exceeds the lineage recording limit.",
    );
  }
  const operationId = stableId("kdocop", {
    projectId: scan.projectId,
    action: "merge",
    sourceId: source.sourceId,
    destinationSourceId: destination.sourceId,
    sourcePath,
    destinationPath,
    sourceHash: source.contentHash,
    destinationBeforeHash: destination.contentHash,
    destinationAfterHash,
    composition: "destination_then_source",
  });
  const lineage = createDocumentMergeLineage({
    projectId: scan.projectId,
    operationId,
    sourcePath,
    destinationPath,
    sourceIdentityPath: source.identityPath ?? source.path,
    sourceId: source.sourceId,
    destinationIdentityPath: destination.identityPath ?? destination.path,
    destinationSourceId: destination.sourceId,
    sourceHash: source.contentHash,
    sourceByteCount: source.byteCount,
    destinationBeforeHash: destination.contentHash,
    destinationBeforeByteCount: destination.byteCount,
    destinationAfterHash,
    destinationAfterByteCount,
    sourceUnitIds: sourceUnits.map((item) => item.unitId),
    destinationUnitIds: destinationUnits.map((item) => item.unitId),
  });
  const virtualScan = mergeRepositoryKnowledgeScanSources({
    scan,
    sourcePath,
    destinationPath,
    destinationContent,
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
      "Generated publications cannot be updated safely after the merge.",
    );
  }
  const registrySidecars = new Map(
    await Promise.all(
      storedConcepts.map(
        async (item) => [item.file, await safeSidecar(resolve(root, item.file))] as const,
      ),
    ),
  );
  const sourceConceptFile = sourceRelated[0]!.file;
  const sourceConceptSidecar = registrySidecars.get(sourceConceptFile)!;
  const sourceConceptContent = stringify(
    {
      ...sourceConceptSidecar.value,
      freshness: "stale",
      publicationStatus: "deprecated",
      deprecation: {
        kind: "document_merged",
        operationId,
        sourceContentHash: source.contentHash,
        destinationSourceId: destination.sourceId,
      },
    },
    { lineWidth: 0, sortMapEntries: true },
  );
  const sourceConceptOperation: KnowledgeFileOperation = {
    path: sourceConceptFile,
    action: "update",
    ownership: "lervo_generated",
    mediaType: "application/yaml",
    content: sourceConceptContent,
    expectedCurrentHash: sha256(sourceConceptSidecar.bytes),
    desiredHash: sha256(sourceConceptContent),
  };
  const structuralOperations = structural.operations.filter(
    (item) => item.path !== sourceConceptFile,
  );
  const lineageOperation: KnowledgeFileOperation = {
    path: lineage.file,
    action: "create",
    ownership: "lervo_generated",
    mediaType: "application/yaml",
    content: lineage.content,
    desiredHash: sha256(lineage.content),
  };
  const moveLineages = await loadDocumentMoveLineages({
    repositoryRoot: root,
    projectId: scan.projectId,
  });
  const terminalSourceMove = moveLineages.records.find(
    (item) => item.activeTerminal && item.value.toPath === sourcePath,
  );
  const sourceMoveClosure: KnowledgeFileOperation[] =
    terminalSourceMove === undefined
      ? []
      : (() => {
          const content = stringify(
            {
              ...terminalSourceMove.value,
              closure: {
                kind: "document_merged",
                operationId,
                sourceContentHash: source.contentHash,
                destinationPath,
                destinationSourceId: destination.sourceId,
              },
            },
            { lineWidth: 0, sortMapEntries: true },
          );
          return [
            {
              path: terminalSourceMove.file,
              action: "update",
              ownership: "lervo_generated",
              mediaType: "application/yaml",
              content,
              expectedCurrentHash: sha256(terminalSourceMove.bytes),
              desiredHash: sha256(content),
            },
          ];
        })();
  const destinationOperation: DurableKnowledgeUserFileOperation = {
    path: destinationPath,
    action: "update",
    ownership: "user",
    mediaType: "text/markdown",
    content: destinationContent,
    expectedCurrentHash: destination.contentHash,
    desiredHash: destinationAfterHash,
  };
  const sourceDeleteOperation: DurableKnowledgeDeleteOperation = {
    path: sourcePath,
    action: "delete",
    expectedCurrentHash: source.contentHash,
  };
  const operations: Array<
    KnowledgeFileOperation | DurableKnowledgeUserFileOperation | DurableKnowledgeDeleteOperation
  > = [
    ...structuralOperations,
    sourceConceptOperation,
    lineageOperation,
    ...sourceMoveClosure,
    destinationOperation,
    sourceDeleteOperation,
  ];
  const registryMaterials = [...registrySidecars].map(([file, item]) => ({
    file,
    contentHash: sha256(item.bytes),
  }));
  registryMaterials.sort((left, right) => left.file.localeCompare(right.file));
  const registryDigest = sha256(canonicalJson(registryMaterials));
  const conceptOperations = [...structuralOperations, sourceConceptOperation].filter(
    (operation) =>
      operation.path.startsWith(`${structuralConceptDirectory}/`) &&
      operation.action !== "conflict",
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
  const operationBindings = operations.map((operation) =>
    operation.action === "delete"
      ? operation
      : (({ content: _content, ...item }) => item)(operation),
  );
  const approvalHash = sha256(
    canonicalJson({
      operationId,
      action: "merge_user_document",
      composition: "destination_then_source",
      source: { path: sourcePath, contentHash: source.contentHash, byteCount: source.byteCount },
      destination: {
        path: destinationPath,
        beforeHash: destination.contentHash,
        afterHash: destinationAfterHash,
        beforeByteCount: destination.byteCount,
        afterByteCount: destinationAfterByteCount,
      },
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
  const plan: KnowledgeDocumentMergePlan = {
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
    source: {
      path: sourcePath,
      contentHash: source.contentHash,
      byteCount: source.byteCount,
      conceptId: sourceRelated[0]!.value!.conceptId,
    },
    destination: {
      path: destinationPath,
      beforeHash: destination.contentHash,
      afterHash: destinationAfterHash,
      beforeByteCount: destination.byteCount,
      afterByteCount: destinationAfterByteCount,
      conceptId: destinationRelated[0]!.value!.conceptId,
    },
    composition: "destination_then_source",
    preservedConceptIds: [destinationRelated[0]!.value!.conceptId],
    createdConceptIds,
    updatedConceptIds,
    deprecatedConceptIds,
    lineageId: lineage.value.lineageId,
    operations,
  };
  await authorizeCurrentRepositoryDocumentLayout({ repositoryRoot: root, operations });
  return plan;
}

export async function applyKnowledgeDocumentMergePlan(input: {
  plan: KnowledgeDocumentMergePlan;
  approvedOperationId: string;
  approvedHash: string;
  now: Date;
  recordApplied: (receipt: KnowledgeDocumentMergeReceipt) => void | Promise<void>;
  supplementalSources?: RepositoryKnowledgeScanOptions["supplementalSources"];
  failureInjector?: (
    checkpoint: KnowledgeMaterializationCheckpoint,
  ) => "interrupt" | void | Promise<"interrupt" | void>;
}): Promise<KnowledgeDocumentMergeReceipt> {
  if (
    input.approvedOperationId !== input.plan.operationId ||
    !HASH.test(input.approvedHash) ||
    input.approvedHash !== input.plan.approvalHash
  ) {
    throw new RepositoryKnowledgeError(
      "knowledge_approval_required",
      "A document merge requires an operation ID and exact approval hash.",
    );
  }
  const current = await createKnowledgeDocumentMergePlan({
    repositoryRoot: input.plan.repositoryRoot,
    sourcePath: input.plan.source.path,
    destinationPath: input.plan.destination.path,
    ...(input.supplementalSources === undefined
      ? {}
      : { supplementalSources: input.supplementalSources }),
  });
  if (current.planId !== input.plan.planId)
    throw new RepositoryKnowledgeError(
      "knowledge_plan_stale",
      "The documents, registry, policy, or source snapshot changed after the merge was planned.",
    );
  const receipt: KnowledgeDocumentMergeReceipt = {
    schemaVersion: 1,
    type: "knowledge.materialization.applied",
    operation: "document_structure_merge",
    planId: current.planId,
    operationId: current.operationId,
    projectId: current.projectId,
    sourceSnapshotId: current.sourceSnapshotId,
    afterSourceSnapshotId: current.afterSourceSnapshotId,
    approvalHash: current.approvalHash,
    sourcePathDigest: sha256(current.source.path),
    destinationPathDigest: sha256(current.destination.path),
    destinationAfterHash: current.destination.afterHash,
    mergedByteCount: current.source.byteCount,
    preservedConceptIds: current.preservedConceptIds,
    deprecatedConceptIds: current.deprecatedConceptIds,
    lineageId: current.lineageId,
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
