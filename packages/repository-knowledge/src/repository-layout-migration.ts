import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { loadDecisionTaxonomy, type DecisionTaxonomy } from "@lervo/project";

import {
  createKnowledgeMigrationPlanForScan,
  recordedGeneratedKnowledgePaths,
  scanCompleteConfiguredRepositoryKnowledge,
} from "./compiler.js";
import type { ConceptSidecarCache } from "./concept-sidecar-cache.js";
import { planDecisionTaxonomyRefresh } from "./decision-taxonomy-refresh.js";
import { authorizeCurrentRepositoryDocumentLayout } from "./document-layout-enforcement.js";
import type { DocumentRouteResolutionContext } from "./document-route-resolution.js";
import type { DurableKnowledgeUserFileOperation } from "./durable-apply.js";
import { canonicalJson, sha256, stableId } from "./integrity.js";
import { accountRepositoryLayoutCandidates } from "./repository-layout-accounting.js";
import {
  classifyRepositoryLayoutCandidates,
  type RepositoryLayoutCandidates,
} from "./repository-layout-candidates.js";
import {
  holdRepositoryLayoutMovesOverCapacity,
  type RepositoryLayoutCapacityFinding,
} from "./repository-layout-capacity.js";
import { inspectRepositoryLayoutDestinations } from "./repository-layout-destinations.js";
import { planRepositoryLayoutDocumentMoves } from "./repository-layout-document-moves.js";
import {
  planInstructionBridgeRecordOperations,
  planRepositoryInstructionRouteRefresh,
} from "./repository-layout-instruction-surfaces.js";
import {
  normalizationOwnershipUpgradeOperations,
  planRepositoryLayoutMachineMoves,
  repositoryLayoutRegistryDigest,
} from "./repository-layout-machine-artifacts.js";
import {
  withoutContent,
  type RepositoryLayoutMachineMove,
  type RepositoryLayoutMigrationPlan,
  type RepositoryLayoutMove,
  type RepositoryLayoutReferenceUpdate,
  type RepositoryLayoutUserUpdate,
} from "./repository-layout-plan.js";
import {
  planRepositoryLayoutReferenceRewrites,
  repositoryLayoutReferenceUpdates,
} from "./repository-layout-references.js";
import {
  planRepositoryLayoutPublicationIgnore,
  planRepositoryLayoutReferenceUpdates,
} from "./repository-layout-user-updates.js";
import { loadStoredConcepts } from "./store-reader.js";
import {
  RepositoryKnowledgeError,
  type KnowledgeFileOperation,
  type KnowledgeMigrationPlan,
  type RepositoryKnowledgePolicy,
  type RepositoryKnowledgePreparedScanOptions,
  type RepositoryKnowledgeScan,
  type RepositoryKnowledgeScanOptions,
} from "./types.js";

export {
  serializableRepositoryLayoutMigrationPlan,
  type RepositoryLayoutMachineMove,
  type RepositoryLayoutMigrationPlan,
  type RepositoryLayoutMove,
  type RepositoryLayoutReferenceUpdate,
  type RepositoryLayoutUserUpdate,
} from "./repository-layout-plan.js";

type RepositoryLayoutPlanRequest = Parameters<typeof createRepositoryLayoutMigrationPlan>[0];

/** The scan, taxonomy, and registries one plan reads; an incomplete concept registry fails. */
async function loadRepositoryLayoutInputs(root: string, input: RepositoryLayoutPlanRequest) {
  const taxonomyPath = resolve(root, ".lervo/knowledge/document-layout.yaml");
  const taxonomySource = await readFile(taxonomyPath, "utf8");
  const [{ policy, scan }, storedConcepts, generatedPaths, taxonomy] = await Promise.all([
    scanCompleteConfiguredRepositoryKnowledge(root, {
      ...(input.supplementalSources === undefined
        ? {}
        : { supplementalSources: input.supplementalSources }),
      ...(input.preparedScan === undefined ? {} : { preparedScan: input.preparedScan }),
    }),
    loadStoredConcepts(root, input.conceptCache),
    recordedGeneratedKnowledgePaths(root),
    loadDecisionTaxonomy(root),
  ]);
  if (storedConcepts.some((item) => item.value === null))
    throw new RepositoryKnowledgeError(
      "knowledge_reconciliation_conflict",
      "The knowledge concept registry is incomplete.",
      {
        code: "knowledge_concept_registry_incomplete",
        message: "The knowledge concept registry is incomplete.",
      },
    );
  return { taxonomySource, policy, scan, storedConcepts, generatedPaths, taxonomy };
}

/**
 * Registry upgrades and the structural recompilation of the post-migration scan. A plan with
 * nothing to write, or one that only adds the publication ignore rule, skips recompilation.
 */
async function planStructuralRefresh(input: {
  root: string;
  scan: RepositoryKnowledgeScan;
  virtualScan: RepositoryKnowledgeScan;
  taxonomySource: string;
  taxonomy: DecisionTaxonomy;
  moves: RepositoryLayoutMove[];
  userUpdates: RepositoryLayoutUserUpdate[];
  publicationIgnoreOperationCount: number;
}): Promise<{
  normalizationOwnershipOperations: KnowledgeFileOperation[];
  taxonomyUpgradeOperation: KnowledgeFileOperation[];
  structural: KnowledgeMigrationPlan | null;
}> {
  const normalizationOwnershipOperations = await normalizationOwnershipUpgradeOperations(
    input.root,
  );
  const scannedPaths = new Set(input.scan.sources.map((source) => source.path));
  const taxonomyUpgradeOperation = planDecisionTaxonomyRefresh({
    taxonomySource: input.taxonomySource,
    taxonomy: input.taxonomy,
    pathExists: (path) => scannedPaths.has(path),
    placedPaths: new Set(input.moves.map((move) => move.toPath)),
  });
  const structural =
    input.publicationIgnoreOperationCount > 0 ||
    (input.moves.length === 0 &&
      input.userUpdates.length === 0 &&
      normalizationOwnershipOperations.length === 0 &&
      taxonomyUpgradeOperation.length === 0)
      ? null
      : await createKnowledgeMigrationPlanForScan({
          repositoryRoot: input.root,
          scan: input.virtualScan,
          mode: "migrate",
        });
  return { normalizationOwnershipOperations, taxonomyUpgradeOperation, structural };
}

/** Assembles the plan from its phases and derives its status and content-bound plan ID. */
function assembleRepositoryLayoutPlan(input: {
  root: string;
  request: RepositoryLayoutPlanRequest;
  scan: RepositoryKnowledgeScan;
  virtualScan: RepositoryKnowledgeScan;
  policy: RepositoryKnowledgePolicy;
  taxonomy: DecisionTaxonomy;
  classified: RepositoryLayoutCandidates;
  deferredDocuments: RepositoryLayoutMigrationPlan["deferredDocuments"];
  capacityFindings: RepositoryLayoutCapacityFinding[];
  registryDigest: string;
  moves: RepositoryLayoutMove[];
  userUpdates: RepositoryLayoutUserUpdate[];
  machineMoves: RepositoryLayoutMachineMove[];
  referenceOperations: DurableKnowledgeUserFileOperation[];
  referenceUpdates: RepositoryLayoutReferenceUpdate[];
  managedAgentRouteOperation: KnowledgeFileOperation | null;
  taxonomyUpgradeOperation: KnowledgeFileOperation[];
  normalizationOwnershipOperations: KnowledgeFileOperation[];
  blockers: RepositoryLayoutMigrationPlan["blockers"];
  operations: RepositoryLayoutMigrationPlan["operations"];
}): RepositoryLayoutMigrationPlan {
  const { scan, virtualScan, taxonomy, classified, deferredDocuments, blockers } = input;
  const { moves, userUpdates, machineMoves, operations } = input;
  const documentRouteContext = input.request.documentRouteContext;
  const taxonomyHash = sha256(canonicalJson(taxonomy));
  const policyHash = sha256(canonicalJson({ knowledge: input.policy, decisionTaxonomy: taxonomy }));
  const status =
    blockers.length > 0
      ? "blocked"
      : moves.length > 0 || userUpdates.length > 0
        ? "review_required"
        : machineMoves.length > 0 ||
            input.managedAgentRouteOperation !== null ||
            input.taxonomyUpgradeOperation.length > 0 ||
            input.normalizationOwnershipOperations.length > 0
          ? "ready"
          : "current";
  const materials = {
    projectId: scan.projectId,
    sourceSnapshotId: scan.snapshotId,
    afterSourceSnapshotId: virtualScan.snapshotId,
    policyHash,
    taxonomyHash,
    registryDigest: input.registryDigest,
    moves,
    userUpdates,
    machineMoves,
    referenceUpdates: input.referenceOperations.map(withoutContent),
    operations: operations.map(withoutContent),
    blockers,
    ...(documentRouteContext === undefined ? {} : { documentRouteContext }),
    deferredDocuments,
    deferredDocumentCount: deferredDocuments.length,
    retainedDocuments: classified.retainedDocuments,
    retainedDocumentCount: classified.retainedDocumentCount,
    semanticClassificationIds: [...classified.liveClassificationIds].sort(),
  };
  return {
    schemaVersion: 1,
    planKind: "repository_layout",
    planId: stableId("klayout", materials),
    status,
    projectId: scan.projectId,
    repositoryRoot: input.root,
    sourceSnapshotId: scan.snapshotId,
    afterSourceSnapshotId: virtualScan.snapshotId,
    policyHash,
    taxonomyHash,
    coverage: {
      ...scan.inventoryCoverage,
      complete: scan.inventoryCoverage.complete && deferredDocuments.length === 0,
    },
    registryDigest: input.registryDigest,
    moves,
    userUpdates,
    machineMoves,
    referenceUpdates: input.referenceUpdates,
    ...(documentRouteContext === undefined ? {} : { documentRouteContext }),
    deferredDocuments,
    deferredDocumentCount: deferredDocuments.length,
    retainedDocuments: classified.retainedDocuments,
    retainedDocumentCount: classified.retainedDocumentCount,
    semanticClassificationIds: [...classified.liveClassificationIds].sort(),
    layoutCapacity: input.capacityFindings,
    blockers,
    operations,
  };
}

export async function createRepositoryLayoutMigrationPlan(input: {
  repositoryRoot: string;
  supplementalSources?: RepositoryKnowledgeScanOptions["supplementalSources"];
  preparedScan?: RepositoryKnowledgePreparedScanOptions["preparedScan"];
  documentRouteContext?: DocumentRouteResolutionContext;
  /** ADR-0601: a long-lived reader reuses concept decoding across plans; bytes are always read. */
  conceptCache?: ConceptSidecarCache;
}): Promise<RepositoryLayoutMigrationPlan> {
  const root = resolve(input.repositoryRoot);
  const { taxonomySource, policy, scan, storedConcepts, generatedPaths, taxonomy } =
    await loadRepositoryLayoutInputs(root, input);
  const classified = await classifyRepositoryLayoutCandidates({
    root,
    scan,
    taxonomy,
    ...(input.documentRouteContext === undefined
      ? {}
      : { documentRouteContext: input.documentRouteContext }),
  });
  const { blockers, blockedDestinations } = await inspectRepositoryLayoutDestinations({
    root,
    scan,
    policy,
    taxonomy,
    generatedPaths,
    classified,
  });
  // Blocked candidates remain represented by their blockers but must never be
  // projected into the virtual post-migration scan. In particular, two source
  // documents that select the same destination would otherwise make the
  // second projection throw instead of returning a reviewable blocked plan.
  const capacity = holdRepositoryLayoutMovesOverCapacity({
    scan,
    taxonomy,
    candidates: classified.candidates.filter((item) => !blockedDestinations.has(item.toPath)),
  });
  const { executableCandidates, deferredDocuments } = accountRepositoryLayoutCandidates({
    classified,
    blockedDestinations,
    heldDestinations: capacity.heldDestinations,
  });
  const rewrites = await planRepositoryLayoutReferenceRewrites({
    root,
    scan,
    taxonomy,
    generatedPaths,
    movePaths: executableCandidates.map(({ source, toPath }) => ({
      fromPath: source.path,
      toPath,
    })),
  });
  const { movedContentChanges } = rewrites;
  const { referenceChanges, managedAgentRouteOperation } = planRepositoryInstructionRouteRefresh({
    scan,
    generatedPaths,
    executableCandidates,
    referenceChanges: rewrites.referenceChanges,
  });
  const registryDigest = await repositoryLayoutRegistryDigest(root, storedConcepts);
  const { virtualScan, moves, lineageOperations, moveOperations } =
    planRepositoryLayoutDocumentMoves({
      scan,
      storedConcepts,
      executableCandidates,
      movedContentChanges,
      referenceChanges,
      managedAgentRouteOperation,
    });
  const { referenceOperations, referenceUserUpdates } = planRepositoryLayoutReferenceUpdates({
    projectId: scan.projectId,
    referenceChanges,
    documentMoveCount: moves.length,
  });
  const publicationIgnore = await planRepositoryLayoutPublicationIgnore({
    root,
    projectId: scan.projectId,
    publicationRoot: policy.publicationRoot,
  });
  const userUpdates = [...referenceUserUpdates, ...publicationIgnore.userUpdates];
  const { normalizationOwnershipOperations, taxonomyUpgradeOperation, structural } =
    await planStructuralRefresh({
      root,
      scan,
      virtualScan,
      taxonomySource,
      taxonomy,
      moves,
      userUpdates,
      publicationIgnoreOperationCount: publicationIgnore.operations.length,
    });
  if (structural?.operations.some((operation) => operation.action === "conflict"))
    blockers.push({ code: "destination_exists", pathDigest: sha256("structural-output-conflict") });
  const bridgeOperations = await planInstructionBridgeRecordOperations({
    root,
    ...(input.supplementalSources === undefined
      ? {}
      : { supplementalSources: input.supplementalSources }),
    referenceChanges,
    managedAgentRouteOperation,
  });
  const machine = await planRepositoryLayoutMachineMoves(
    root,
    new Set((structural?.operations ?? []).map((operation) => operation.path)),
  );
  blockers.push(...machine.blockers);
  const operations: RepositoryLayoutMigrationPlan["operations"] = [
    ...taxonomyUpgradeOperation,
    ...normalizationOwnershipOperations,
    ...(structural?.operations ?? []),
    ...publicationIgnore.operations,
    ...(managedAgentRouteOperation === null ? [] : [managedAgentRouteOperation]),
    ...referenceOperations,
    ...bridgeOperations,
    ...lineageOperations,
    ...moveOperations,
    ...machine.machineMoveOperations,
  ];
  const plan = assembleRepositoryLayoutPlan({
    root,
    request: input,
    scan,
    virtualScan,
    policy,
    taxonomy,
    classified,
    deferredDocuments,
    capacityFindings: capacity.findings,
    registryDigest,
    moves,
    userUpdates,
    machineMoves: machine.machineMoves,
    referenceOperations,
    referenceUpdates: repositoryLayoutReferenceUpdates({
      referenceChanges,
      movedContentChanges,
      executableCandidates,
    }),
    managedAgentRouteOperation,
    taxonomyUpgradeOperation,
    normalizationOwnershipOperations,
    blockers,
    operations,
  });
  if (blockers.length === 0)
    await authorizeCurrentRepositoryDocumentLayout({ repositoryRoot: root, operations });
  return plan;
}
