import type {
  DurableKnowledgeMoveOperation,
  DurableKnowledgeMoveUpdateOperation,
} from "./durable-apply.js";
import { canonicalJson, sha256, stableId } from "./integrity.js";
import type { RepositoryLayoutCandidate } from "./repository-layout-candidates.js";
import type { RepositoryLayoutMove } from "./repository-layout-plan.js";
import type { RepositoryLayoutReferenceChange } from "./repository-layout-references.js";
import {
  relocateRepositoryKnowledgeScanSources,
  upsertRepositoryKnowledgeScanSources,
} from "./scanner.js";
import { createDocumentMoveLineage } from "./source-lineage.js";
import type { StoredConcept, StoredValue } from "./store-reader.js";
import {
  RepositoryKnowledgeError,
  type KnowledgeFileOperation,
  type RepositoryKnowledgeScan,
} from "./types.js";

interface ReferenceApprovalBinding {
  path: string;
  beforeHash: string;
  afterHash: string;
  replacementCount: number;
}

/**
 * One user-document move bound to its exact source and destination bytes, its source units, its
 * lineage record, and every reference update the same plan writes.
 */
function planDocumentMove(input: {
  item: RepositoryLayoutCandidate;
  changedContent: { content: string; count: number } | undefined;
  virtualScan: RepositoryKnowledgeScan;
  projectId: string;
  storedConcepts: Array<StoredValue<StoredConcept>>;
  referenceApprovalBindings: ReferenceApprovalBinding[];
}): {
  move: RepositoryLayoutMove;
  lineageOperation: KnowledgeFileOperation;
  moveOperation: DurableKnowledgeMoveOperation | DurableKnowledgeMoveUpdateOperation;
} {
  const { item, changedContent, projectId } = input;
  const destinationContentHash =
    changedContent === undefined ? item.source.contentHash! : sha256(changedContent.content);
  const sourceUnits = input.virtualScan.units.filter(
    (unit) => unit.sourceId === item.source.sourceId,
  );
  const preservedConceptIds = input.storedConcepts
    .filter(
      (stored) =>
        stored.value?.path === item.source.path &&
        stored.value.ownership === "user" &&
        stored.value.publicationStatus !== "deprecated",
    )
    .map((stored) => stored.value!.conceptId)
    .sort();
  if (preservedConceptIds.length > 1 || sourceUnits.length < 1 || sourceUnits.length > 16384)
    throw new RepositoryKnowledgeError(
      "knowledge_reconciliation_conflict",
      "The layout migration source identity is ambiguous.",
    );
  const operationId = stableId("kdocop", {
    projectId,
    action: "layout_move",
    sourceId: item.source.sourceId,
    fromPath: item.source.path,
    toPath: item.toPath,
    contentHash: item.source.contentHash,
    destinationContentHash,
    sourceUnitIds: sourceUnits.map((unit) => unit.unitId).sort(),
  });
  const lineage = createDocumentMoveLineage({
    projectId,
    operationId,
    fromPath: item.source.path,
    toPath: item.toPath,
    identityPath: item.source.identityPath ?? item.source.path,
    sourceId: item.source.sourceId,
    sourceContentHash: destinationContentHash,
    sourceUnitIds: sourceUnits.map((unit) => unit.unitId),
  });
  const approvalHash = sha256(
    canonicalJson({
      operationId,
      action: "move_user_document",
      source: {
        path: item.source.path,
        contentHash: item.source.contentHash,
        byteCount: item.source.byteCount,
      },
      destination: { path: item.toPath, contentHash: destinationContentHash },
      lineageId: lineage.value.lineageId,
      referenceUpdates: input.referenceApprovalBindings,
    }),
  );
  return {
    move: {
      operationId,
      approvalHash,
      fromPath: item.source.path,
      toPath: item.toPath,
      contentHash: item.source.contentHash!,
      destinationContentHash,
      byteCount: item.source.byteCount,
      preservedConceptIds,
      lineageId: lineage.value.lineageId,
      classification: item.classification,
      ...(item.group === undefined ? {} : { group: item.group }),
      ...(item.subgroup === undefined ? {} : { subgroup: item.subgroup }),
      ...(item.routeId === undefined ? {} : { routeId: item.routeId }),
      ...(item.classificationBasis === undefined
        ? {}
        : { classificationBasis: item.classificationBasis }),
      ...(item.semanticClassification === undefined
        ? {}
        : { semanticClassification: item.semanticClassification }),
      reason: item.reason,
    },
    lineageOperation: {
      path: lineage.file,
      action: "create",
      ownership: "lervo_generated",
      mediaType: "application/yaml",
      content: lineage.content,
      desiredHash: sha256(lineage.content),
    },
    moveOperation:
      changedContent === undefined
        ? {
            path: item.source.path,
            destinationPath: item.toPath,
            action: "move",
            expectedCurrentHash: item.source.contentHash!,
          }
        : {
            path: item.source.path,
            destinationPath: item.toPath,
            action: "move_update",
            ownership: "user",
            mediaType: "text/markdown",
            expectedCurrentHash: item.source.contentHash!,
            desiredHash: destinationContentHash,
            content: changedContent.content,
          },
  };
}

/**
 * Projects every rewritten file into a virtual scan, plans each executable move against it, and
 * returns the post-migration scan with the moved sources relocated.
 */
export function planRepositoryLayoutDocumentMoves(input: {
  scan: RepositoryKnowledgeScan;
  storedConcepts: Array<StoredValue<StoredConcept>>;
  executableCandidates: RepositoryLayoutCandidate[];
  movedContentChanges: ReadonlyMap<string, { content: string; count: number }>;
  referenceChanges: ReadonlyMap<string, RepositoryLayoutReferenceChange>;
  managedAgentRouteOperation: KnowledgeFileOperation | null;
}): {
  virtualScan: RepositoryKnowledgeScan;
  moves: RepositoryLayoutMove[];
  lineageOperations: KnowledgeFileOperation[];
  moveOperations: Array<DurableKnowledgeMoveOperation | DurableKnowledgeMoveUpdateOperation>;
} {
  const { scan, movedContentChanges, referenceChanges, managedAgentRouteOperation } = input;
  // One batch, so the scan's snapshot is digested once instead of once per changed document.
  const virtualScan = upsertRepositoryKnowledgeScanSources(scan, [
    ...[...movedContentChanges]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([path, change]) => ({ path, content: change.content })),
    ...[...referenceChanges.values()]
      .sort((left, right) => left.source.path.localeCompare(right.source.path))
      .map((change) => ({ path: change.source.path, content: change.content })),
    ...(managedAgentRouteOperation?.content === undefined
      ? []
      : [{ path: "AGENTS.md", content: managedAgentRouteOperation.content }]),
  ]);
  const relocations: Array<{ fromPath: string; toPath: string }> = [];
  const moves: RepositoryLayoutMove[] = [];
  const lineageOperations: KnowledgeFileOperation[] = [];
  const moveOperations: Array<DurableKnowledgeMoveOperation | DurableKnowledgeMoveUpdateOperation> =
    [];
  const referenceApprovalBindings = [...referenceChanges.values()]
    .sort((left, right) => left.source.path.localeCompare(right.source.path))
    .map((change) => ({
      path: change.source.path,
      beforeHash: change.source.contentHash,
      afterHash: sha256(change.content),
      replacementCount: change.count,
    }));
  for (const item of input.executableCandidates) {
    const planned = planDocumentMove({
      item,
      changedContent: movedContentChanges.get(item.source.path),
      virtualScan,
      projectId: scan.projectId,
      storedConcepts: input.storedConcepts,
      referenceApprovalBindings,
    });
    moves.push(planned.move);
    lineageOperations.push(planned.lineageOperation);
    moveOperations.push(planned.moveOperation);
    // Moving a source keeps its units' source IDs, so each move's unit lookup reads the same units
    // before or after the earlier moves; the moves are projected together after the loop.
    relocations.push({ fromPath: item.source.path, toPath: item.toPath });
  }
  return {
    virtualScan: relocateRepositoryKnowledgeScanSources(virtualScan, relocations),
    moves,
    lineageOperations,
    moveOperations,
  };
}
