import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { resolve } from "node:path";

import { loadProjectManifest } from "@lervo/project";
import { parse, stringify } from "yaml";

import { scanConfiguredRepositoryKnowledge } from "./compiler.js";
import { applyDurableKnowledgeOperations, type DurableKnowledgeDeleteOperation, type KnowledgeMaterializationCheckpoint } from "./durable-apply.js";
import { canonicalJson, sha256, stableId } from "./integrity.js";
import { loadStoredConcepts } from "./store-reader.js";
import { loadDocumentMoveLineages, normalizeKnowledgeDocumentPath } from "./source-lineage.js";
import { RepositoryKnowledgeError, type KnowledgeFileOperation, type RepositoryKnowledgeScanOptions } from "./types.js";

export interface KnowledgeDocumentDeletionPlan {
  schemaVersion: 1;
  planId: string;
  operationId: string;
  approvalHash: string;
  status: "review_required";
  projectId: string;
  repositoryRoot: string;
  sourceSnapshotId: string;
  policyHash: string;
  coverage: { included: number; excluded: number; unsupported: number; includedBytes: number; complete: boolean };
  registryDigest: string;
  afterRegistryDigest: string;
  document: { path: string; contentHash: string; byteCount: number };
  deprecatedConceptIds: string[];
  operations: Array<KnowledgeFileOperation | DurableKnowledgeDeleteOperation>;
}

export interface KnowledgeDocumentDeletionReceipt {
  schemaVersion: 1;
  type: "knowledge.materialization.applied";
  operation: "document_structure_delete";
  planId: string;
  operationId: string;
  projectId: string;
  sourceSnapshotId: string;
  approvalHash: string;
  deletedPathDigest: string;
  deprecatedConceptIds: string[];
  updatedSidecars: string[];
  appliedAt: string;
}

const HASH = /^sha256:[a-f0-9]{64}$/;

async function readSidecar(path: string): Promise<{ bytes: Buffer; value: Record<string, unknown> }> {
  let handle;
  try {
    handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const before = await handle.stat();
    if (!before.isFile() || before.size > 256 * 1024) throw new Error("unsafe sidecar");
    const bytes = await handle.readFile();
    const after = await handle.stat();
    if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size || before.mtimeMs !== after.mtimeMs || bytes.byteLength !== before.size) throw new Error("sidecar changed");
    const value = parse(bytes.toString("utf8")) as Record<string, unknown> | null;
    if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid sidecar");
    return { bytes, value };
  } catch {
    throw new RepositoryKnowledgeError("knowledge_reconciliation_conflict", "The target concept sidecar cannot be read safely.");
  } finally { await handle?.close(); }
}

export function serializableKnowledgeDocumentDeletionPlan(plan: KnowledgeDocumentDeletionPlan): Omit<KnowledgeDocumentDeletionPlan, "operations"> & {
  operations: Array<Omit<KnowledgeFileOperation, "content"> | DurableKnowledgeDeleteOperation>;
} {
  return { ...plan, operations: plan.operations.map((operation) => operation.action === "delete" ? operation : (({ content: _content, ...item }) => item)(operation)) };
}

export async function createKnowledgeDocumentDeletionPlan(input: {
  repositoryRoot: string;
  documentPath: string;
  supplementalSources?: RepositoryKnowledgeScanOptions["supplementalSources"];
}): Promise<KnowledgeDocumentDeletionPlan> {
  const root = resolve(input.repositoryRoot);
  const path = normalizeKnowledgeDocumentPath(root, input.documentPath);
  const [{ policy, scan }, project, storedConcepts] = await Promise.all([
    scanConfiguredRepositoryKnowledge(root, input.supplementalSources === undefined ? {} : { supplementalSources: input.supplementalSources }),
    loadProjectManifest(root),
    loadStoredConcepts(root),
  ]);
  const source = scan.sources.find((item) => item.path === path);
  if (source?.status !== "included" || source.contentHash === null || source.content === undefined || (source.kind !== "documentation" && source.kind !== "instruction")) {
    throw new RepositoryKnowledgeError("knowledge_reconciliation_conflict", "The delete target must be a regular Markdown document in the current snapshot.");
  }
  const invalidRegistry = storedConcepts.some((item) => item.value === null);
  if (invalidRegistry) throw new RepositoryKnowledgeError("knowledge_reconciliation_conflict", "Document deletion cannot be planned because the knowledge concept registry is incomplete.");
  const related = storedConcepts.filter((item) => item.value?.path === path);
  if (related.length === 0 || related.some((item) => item.value?.ownership !== "user" || item.value.publicationStatus === "deprecated")) {
    throw new RepositoryKnowledgeError("knowledge_reconciliation_conflict", "The delete target must be registered as a current user-owned concept.");
  }
  if (related.length > 256) throw new RepositoryKnowledgeError("knowledge_source_limit_exceeded", "The number of concepts linked to one document exceeds the structural-change limit.");
  const registrySidecars = new Map(await Promise.all(storedConcepts.map(async (item) => [item.file, await readSidecar(resolve(root, item.file))] as const)));
  const registryMaterials = [...registrySidecars].map(([file, loaded]) => ({ file, contentHash: sha256(loaded.bytes) }));
  registryMaterials.sort((left, right) => left.file.localeCompare(right.file));
  const registryDigest = sha256(canonicalJson(registryMaterials));
  const operationId = stableId("kdocop", { projectId: project.projectId, path, sourceHash: source.contentHash, conceptIds: related.map((item) => item.value!.conceptId).sort() });
  const sidecarOperations: KnowledgeFileOperation[] = [];
  for (const item of related.sort((left, right) => left.file.localeCompare(right.file))) {
    const loaded = registrySidecars.get(item.file)!;
    const next = {
      ...loaded.value,
      freshness: "stale",
      publicationStatus: "deprecated",
      deprecation: { kind: "document_deleted", operationId, sourceContentHash: source.contentHash },
    };
    const content = stringify(next, { lineWidth: 0, sortMapEntries: true });
    sidecarOperations.push({
      path: item.file,
      action: "update",
      ownership: "lervo_generated",
      mediaType: "application/yaml",
      content,
      expectedCurrentHash: sha256(loaded.bytes),
      desiredHash: sha256(content),
    });
  }
  const deleteOperation: DurableKnowledgeDeleteOperation = { path, action: "delete", expectedCurrentHash: source.contentHash };
  const lineages = await loadDocumentMoveLineages({ repositoryRoot: root, projectId: project.projectId });
  const terminalLineage = lineages.records.find((item) => item.activeTerminal && item.value.toPath === path);
  const lineageClosureOperation: KnowledgeFileOperation[] = terminalLineage === undefined ? [] : (() => {
    const content = stringify({
      ...terminalLineage.value,
      closure: { kind: "document_deleted", operationId, sourceContentHash: source.contentHash },
    }, { lineWidth: 0, sortMapEntries: true });
    return [{
      path: terminalLineage.file,
      action: "update",
      ownership: "lervo_generated",
      mediaType: "application/yaml",
      content,
      expectedCurrentHash: sha256(terminalLineage.bytes),
      desiredHash: sha256(content),
    }];
  })();
  const nextHashByPath = new Map(sidecarOperations.map((operation) => [operation.path, operation.desiredHash]));
  const afterRegistryDigest = sha256(canonicalJson(registryMaterials.map((item) => ({ ...item, contentHash: nextHashByPath.get(item.file) ?? item.contentHash }))));
  const operationBindings: Array<Omit<KnowledgeFileOperation, "content"> | DurableKnowledgeDeleteOperation> = [
    ...[...sidecarOperations, ...lineageClosureOperation].map(({ content: _content, ...operation }) => operation),
    deleteOperation,
  ];
  const approvalHash = sha256(canonicalJson({ operationId, action: "delete_user_document", source: { path, contentHash: source.contentHash, byteCount: source.byteCount }, operations: operationBindings }));
  const policyHash = sha256(canonicalJson(policy));
  const materials = { projectId: project.projectId, sourceSnapshotId: scan.snapshotId, policyHash, registryDigest, afterRegistryDigest, operationId, approvalHash, operations: operationBindings };
  return {
    schemaVersion: 1,
    planId: stableId("kstruct", materials),
    operationId,
    approvalHash,
    status: "review_required",
    projectId: project.projectId,
    repositoryRoot: root,
    sourceSnapshotId: scan.snapshotId,
    policyHash,
    coverage: scan.coverage,
    registryDigest,
    afterRegistryDigest,
    document: { path, contentHash: source.contentHash, byteCount: source.byteCount },
    deprecatedConceptIds: related.map((item) => item.value!.conceptId).sort(),
    operations: [...sidecarOperations, ...lineageClosureOperation, deleteOperation],
  };
}

export async function applyKnowledgeDocumentDeletionPlan(input: {
  plan: KnowledgeDocumentDeletionPlan;
  approvedOperationId: string;
  approvedHash: string;
  now: Date;
  recordApplied: (receipt: KnowledgeDocumentDeletionReceipt) => void | Promise<void>;
  supplementalSources?: RepositoryKnowledgeScanOptions["supplementalSources"];
  failureInjector?: (checkpoint: KnowledgeMaterializationCheckpoint) => "interrupt" | void | Promise<"interrupt" | void>;
}): Promise<KnowledgeDocumentDeletionReceipt> {
  if (input.approvedOperationId !== input.plan.operationId || !HASH.test(input.approvedHash) || input.approvedHash !== input.plan.approvalHash) {
    throw new RepositoryKnowledgeError("knowledge_approval_required", "Document deletion requires an operation ID and exact approval hash.");
  }
  const current = await createKnowledgeDocumentDeletionPlan({ repositoryRoot: input.plan.repositoryRoot, documentPath: input.plan.document.path, ...(input.supplementalSources === undefined ? {} : { supplementalSources: input.supplementalSources }) });
  if (current.planId !== input.plan.planId) throw new RepositoryKnowledgeError("knowledge_plan_stale", "The document, registry, policy, or source snapshot changed after deletion was planned.");
  const receipt: KnowledgeDocumentDeletionReceipt = {
    schemaVersion: 1,
    type: "knowledge.materialization.applied",
    operation: "document_structure_delete",
    planId: current.planId,
    operationId: current.operationId,
    projectId: current.projectId,
    sourceSnapshotId: current.sourceSnapshotId,
    approvalHash: current.approvalHash,
    deletedPathDigest: sha256(current.document.path),
    deprecatedConceptIds: current.deprecatedConceptIds,
    updatedSidecars: current.operations.filter((operation) => operation.action === "update" && operation.path.startsWith(".lervo/knowledge/concepts/")).map((operation) => operation.path),
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
