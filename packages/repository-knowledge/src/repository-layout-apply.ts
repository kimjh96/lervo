import {
  applyDurableKnowledgeOperations,
  type KnowledgeMaterializationCheckpoint,
} from "./durable-apply.js";
import { authorizeCurrentRepositoryDocumentLayout } from "./document-layout-enforcement.js";
import type { DocumentRouteBasis } from "./document-route-resolution.js";
import { canonicalJson, sha256 } from "./integrity.js";
import { createRepositoryLayoutMigrationPlan } from "./repository-layout-migration.js";
import type { RepositoryLayoutMigrationPlan } from "./repository-layout-plan.js";
import { RepositoryKnowledgeError, type RepositoryKnowledgeScanOptions } from "./types.js";

const HASH = /^sha256:[a-f0-9]{64}$/;

export interface RepositoryLayoutMigrationReceipt {
  schemaVersion: 1;
  type: "knowledge.materialization.applied";
  operation: "migrate";
  planId: string;
  projectId: string;
  sourceSnapshotId: string;
  afterSourceSnapshotId: string;
  approvalDigest: string;
  movedCount: number;
  machineMovedCount: number;
  referenceUpdatedCount: number;
  pathDigests: Array<{ from: string; to: string }>;
  /** The basis of each move's route, by destination digest; semantic ones cite their record. */
  classificationBases: Array<{ to: string; basis: DocumentRouteBasis; recordDigest?: string }>;
  created: string[];
  updated: string[];
  unchanged: string[];
  appliedAt: string;
}

/**
 * The exact content binding of every user-document move and update in a plan. ADR-0561: Lervo
 * supplies these itself once an independent cross-check agreed with the exact plan; they bind the
 * apply to the reviewed bytes and never stand for an owner approval.
 */
export function repositoryLayoutItemBindings(
  plan: Pick<RepositoryLayoutMigrationPlan, "moves" | "userUpdates">,
): Array<{ operationId: string; approvalHash: string }> {
  return [...plan.moves, ...plan.userUpdates].map(({ operationId, approvalHash }) => ({
    operationId,
    approvalHash,
  }));
}

export async function applyRepositoryLayoutMigrationPlan(input: {
  plan: RepositoryLayoutMigrationPlan;
  itemBindings: Array<{ operationId: string; approvalHash: string }>;
  now: Date;
  recordApplied: (receipt: RepositoryLayoutMigrationReceipt) => void | Promise<void>;
  supplementalSources?: RepositoryKnowledgeScanOptions["supplementalSources"];
  failureInjector?: (
    checkpoint: KnowledgeMaterializationCheckpoint,
  ) => "interrupt" | void | Promise<"interrupt" | void>;
}): Promise<RepositoryLayoutMigrationReceipt> {
  if (input.plan.status !== "review_required" && input.plan.status !== "ready")
    throw new RepositoryKnowledgeError(
      "knowledge_reconciliation_conflict",
      "The repository layout migration plan is not applicable.",
    );
  const items = [...input.plan.moves, ...input.plan.userUpdates];
  const bindings = new Map(input.itemBindings.map((item) => [item.operationId, item.approvalHash]));
  if (
    bindings.size !== items.length ||
    items.some(
      (item) =>
        !HASH.test(bindings.get(item.operationId) ?? "") ||
        bindings.get(item.operationId) !== item.approvalHash,
    )
  ) {
    throw new RepositoryKnowledgeError(
      "knowledge_approval_required",
      "Repository layout migration binds every user-document move or update to its exact content hash.",
    );
  }
  const current = await createRepositoryLayoutMigrationPlan({
    repositoryRoot: input.plan.repositoryRoot,
    ...(input.plan.documentRouteContext === undefined
      ? {}
      : { documentRouteContext: input.plan.documentRouteContext }),
    ...(input.supplementalSources === undefined
      ? {}
      : { supplementalSources: input.supplementalSources }),
  });
  if (current.planId !== input.plan.planId)
    throw new RepositoryKnowledgeError(
      "knowledge_plan_stale",
      "A source, destination, reference, or policy changed after repository layout migration was planned.",
    );
  const approvalDigest = sha256(
    canonicalJson(
      [...current.moves, ...current.userUpdates].map((item) => ({
        operationId: item.operationId,
        approvalHash: item.approvalHash,
      })),
    ),
  );
  const receipt: RepositoryLayoutMigrationReceipt = {
    schemaVersion: 1,
    type: "knowledge.materialization.applied",
    operation: "migrate",
    planId: current.planId,
    projectId: current.projectId,
    sourceSnapshotId: current.sourceSnapshotId,
    afterSourceSnapshotId: current.afterSourceSnapshotId,
    approvalDigest,
    movedCount: current.moves.length,
    machineMovedCount: current.machineMoves.length,
    referenceUpdatedCount: current.referenceUpdates.length,
    pathDigests: current.moves.map((move) => ({
      from: sha256(move.fromPath),
      to: sha256(move.toPath),
    })),
    classificationBases: current.moves.flatMap((move) =>
      move.classificationBasis === undefined
        ? []
        : [
            {
              to: sha256(move.toPath),
              basis: move.classificationBasis,
              ...(move.semanticClassification === undefined
                ? {}
                : { recordDigest: move.semanticClassification.recordDigest }),
            },
          ],
    ),
    created: current.operations
      .filter((operation) => operation.action === "create")
      .map((operation) => operation.path),
    updated: current.operations
      .filter((operation) => operation.action === "update")
      .map((operation) => operation.path),
    unchanged: current.operations
      .filter((operation) => operation.action === "unchanged")
      .map((operation) => operation.path),
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
