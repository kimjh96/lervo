import type {
  DurableKnowledgeMoveOperation,
  DurableKnowledgeMoveUpdateOperation,
  DurableKnowledgeUserFileOperation,
} from "./durable-apply.js";
import type { DecisionLayoutBlockerCode } from "./decision-layout.js";
import type { DocumentLayoutBlockerCode } from "./document-layout.js";
import type {
  DocumentRouteBasis,
  SemanticRouteEvidence,
  DocumentRouteResolutionContext,
} from "./document-route-resolution.js";
import type {
  RepositoryLayoutClassification,
  RepositoryLayoutDeferredDocument,
  RepositoryLayoutReason,
  RepositoryLayoutRetainedDocument,
} from "./repository-layout-candidates.js";
import type { KnowledgeFileOperation } from "./types.js";
import type { RepositoryLayoutCapacityFinding } from "./repository-layout-capacity.js";

export interface RepositoryLayoutMove {
  operationId: string;
  approvalHash: string;
  fromPath: string;
  toPath: string;
  contentHash: string;
  destinationContentHash: string;
  byteCount: number;
  preservedConceptIds: string[];
  lineageId: string;
  classification: RepositoryLayoutClassification;
  group?: string;
  subgroup?: string;
  routeId?: string;
  /** ADR-0476: the declaration or recorded semantic evidence the route rests on. */
  classificationBasis?: DocumentRouteBasis;
  semanticClassification?: SemanticRouteEvidence;
  reason: RepositoryLayoutReason;
}

export interface RepositoryLayoutReferenceUpdate {
  path: string;
  beforeHash: string;
  afterHash: string;
  replacementCount: number;
}

export interface RepositoryLayoutUserUpdate {
  operationId: string;
  approvalHash: string;
  path: string;
  beforeHash: string | null;
  afterHash: string;
  reason:
    | "refresh_instruction_routes"
    | "normalize_agent_surface_references"
    | "reconcile_document_rewriters"
    | "exclude_rebuildable_publications";
}

export interface RepositoryLayoutMachineMove {
  fromPath: string;
  toPath: string;
  contentHash: string;
  byteCount: number;
  registry:
    | "bundles"
    | "concepts"
    | "claims"
    | "relations"
    | "source_lineage"
    | "instruction_bridges"
    | "document_normalizations"
    | "semantic_manifests"
    | "inventory"
    | "source_units"
    | "impacts"
    | "candidates";
}

export interface RepositoryLayoutMigrationPlan {
  schemaVersion: 1;
  planKind: "repository_layout";
  planId: string;
  status: "current" | "ready" | "review_required" | "blocked";
  projectId: string;
  repositoryRoot: string;
  sourceSnapshotId: string;
  afterSourceSnapshotId: string;
  policyHash: string;
  taxonomyHash: string;
  coverage: {
    included: number;
    excluded: number;
    unsupported: number;
    includedBytes: number;
    complete: boolean;
  };
  registryDigest: string;
  moves: RepositoryLayoutMove[];
  userUpdates: RepositoryLayoutUserUpdate[];
  machineMoves: RepositoryLayoutMachineMove[];
  referenceUpdates: RepositoryLayoutReferenceUpdate[];
  documentRouteContext?: DocumentRouteResolutionContext;
  /**
   * Documents awaiting a semantic route. They never block: the background resident classifies
   * them, and each one is a precise attention entry until then (ADR-0476).
   */
  deferredDocuments: RepositoryLayoutDeferredDocument[];
  deferredDocumentCount: number;
  /** Markdown kept in place, with the application-content, tool, or semantic evidence why. */
  retainedDocuments: RepositoryLayoutRetainedDocument[];
  retainedDocumentCount: number;
  /** Recorded classifications this plan relies on or waits for; any other record is stale. */
  semanticClassificationIds: string[];
  /** ADR-0583: directories over capacity, with the moves held for them or left as user debt. */
  layoutCapacity?: RepositoryLayoutCapacityFinding[];
  blockers: Array<{
    code:
      | "destination_exists"
      | "destination_in_publication_root"
      | "ambiguous_destination"
      | "invalid_markdown_reference"
      | DecisionLayoutBlockerCode
      | DocumentLayoutBlockerCode;
    pathDigest: string;
    path?: string;
    candidateRouteIds?: string[];
    configuredMaximum?: number;
    observedCount?: number;
  }>;
  operations: Array<
    | KnowledgeFileOperation
    | DurableKnowledgeMoveOperation
    | DurableKnowledgeMoveUpdateOperation
    | DurableKnowledgeUserFileOperation
  >;
}

export function withoutContent(
  operation:
    | KnowledgeFileOperation
    | DurableKnowledgeMoveOperation
    | DurableKnowledgeMoveUpdateOperation
    | DurableKnowledgeUserFileOperation,
): unknown {
  return operation.action === "move"
    ? operation
    : (({ content: _content, ...item }) => item)(operation);
}

export function serializableRepositoryLayoutMigrationPlan(
  plan: RepositoryLayoutMigrationPlan,
): Omit<RepositoryLayoutMigrationPlan, "operations"> & { operations: unknown[] } {
  return { ...plan, operations: plan.operations.map(withoutContent) };
}
