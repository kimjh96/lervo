import { randomUUID } from "node:crypto";

import {
  canonicalJson,
  lintRepositoryKnowledge,
  type RepositorySupplementalSource,
} from "@lervo/repository-knowledge";
import { lifecycleChangedPaths } from "@lervo/repository-knowledge-runtime";
import { openProjectStorage } from "@lervo/project-storage";

import { applyCrossCheckedEffect, crossCheckedEffectLines } from "./cross-checked-effect.js";
import { preserveDocumentBeforeDeletion } from "./document-deletion-preimage.js";
import type { CrossCheckPlan } from "./plan-cross-check.js";
import type { CliIo } from "./types.js";

/** The fields every document structure plan shares (ADR-0353 move, merge, split, delete). */
export interface DocumentStructurePlan {
  planId: string;
  operationId: string;
  approvalHash: string;
  projectId: string;
  sourceSnapshotId: string;
  policyHash: string;
  coverage: unknown;
  registryDigest: string;
  afterRegistryDigest: string;
  operations: ReadonlyArray<{ path: string; action: string; destinationPath?: string }>;
}

export interface DocumentStructureOperation<Plan extends DocumentStructurePlan, Receipt> {
  operation: "move" | "merge" | "split" | "delete";
  plan: Plan;
  /** The one-line reason the notice and the commit carry. */
  reason: string;
  /** A user document the operation deletes; Git must hold its bytes first. */
  deletedPath?: string;
  /** The same operation planned again, after a commit that only preserved existing bytes. */
  replan?(): Promise<DocumentStructureOperation<Plan, Receipt>>;
  conceptIds: { created: string[]; updated: string[]; deprecated: string[] };
  counts(receipt: Receipt): { created: number; updated: number; unchanged: number };
  apply(input: {
    approvedOperationId: string;
    approvedHash: string;
    now: Date;
    supplementalSources: RepositorySupplementalSource[];
    recordApplied: (receipt: Receipt & { appliedAt: string }) => Promise<void>;
  }): Promise<Receipt>;
  describe(receipt: Receipt): string;
}

function withoutContent(operations: DocumentStructurePlan["operations"]): unknown {
  return operations.map((operation) => {
    const { content: _content, ...rest } = operation as typeof operation & { content?: unknown };
    return rest;
  });
}

/**
 * Commit-then-delete: Git holds the document's exact bytes before Lervo removes them. A commit
 * that only preserved existing bytes moves the source snapshot, so the operation is planned again
 * and must change exactly the same bytes as the plan the cross-check agreed with.
 */
async function preservedStructure<Plan extends DocumentStructurePlan, Receipt>(
  repositoryRoot: string,
  structure: DocumentStructureOperation<Plan, Receipt>,
): Promise<DocumentStructureOperation<Plan, Receipt>> {
  if (structure.deletedPath === undefined) return structure;
  const preserved = await preserveDocumentBeforeDeletion({
    repositoryRoot,
    path: structure.deletedPath,
  });
  if (preserved.preservedBy === "head" || structure.replan === undefined) return structure;
  const replanned = await structure.replan();
  if (
    canonicalJson(withoutContent(replanned.plan.operations)) !==
    canonicalJson(withoutContent(structure.plan.operations))
  )
    throw new Error(
      `The document ${structure.operation} changed while Git preserved it; plan it again.`,
    );
  return replanned;
}

/**
 * ADR-0561 for a document structure operation: an independent cross-check of the exact plan, the
 * effect, and its own `Lervo Knowledge` commit as the undo point. Delete is commit-then-delete:
 * Git holds the document's bytes before Lervo removes them.
 */
export async function applyDocumentStructureOperation<
  Plan extends DocumentStructurePlan,
  Receipt extends { planId: string },
>(input: {
  repositoryRoot: string;
  structure: DocumentStructureOperation<Plan, Receipt>;
  supplementalSources: RepositorySupplementalSource[];
  provider?: "codex" | "claude";
  json: boolean;
  io: CliIo;
  crossCheckPlan: CrossCheckPlan;
}): Promise<number> {
  const { structure, repositoryRoot } = input;
  const { plan } = structure;
  const storage = await openProjectStorage(repositoryRoot);
  try {
    if (
      storage.events
        .list()
        .some(
          (event) =>
            event.type === "knowledge.materialization.applied" &&
            event.payload.planId === plan.planId,
        )
    )
      throw new Error(`The same document ${structure.operation} plan was already applied.`);
    const identity = randomUUID().replaceAll("-", "");
    const { receipt, report } = await applyCrossCheckedEffect({
      crossCheckPlan: input.crossCheckPlan,
      repositoryRoot,
      ...(input.provider === undefined ? {} : { provider: input.provider }),
      plan,
      paths: lifecycleChangedPaths(plan),
      // Commit-then-delete: Git holds the deleted document's bytes before Lervo removes them.
      ...(structure.deletedPath === undefined ? {} : { preservedPaths: [structure.deletedPath] }),
      notice: { effect: "document_structure", planId: plan.planId, reason: structure.reason },
      apply: async () => {
        const applying = await preservedStructure(repositoryRoot, structure);
        const plan = applying.plan;
        return applying.apply({
          // The plan's own content binding; the cross-check above agreed with these exact bytes.
          approvedOperationId: plan.operationId,
          approvedHash: plan.approvalHash,
          now: new Date(),
          supplementalSources: input.supplementalSources,
          recordApplied: async (applied) => {
            const validation = await lintRepositoryKnowledge(repositoryRoot, {
              allowTransactionPlanId: plan.planId,
              supplementalSources: input.supplementalSources,
            });
            if (validation.coverage !== "complete" || !validation.valid)
              throw new Error(
                `Deterministic lint failed after the document ${structure.operation}.`,
              );
            const validationArtifact = await storage.artifacts.put(canonicalJson(validation));
            const { created, updated, deprecated } = structure.conceptIds;
            const counts = structure.counts(applied);
            storage.events.append({
              eventId: `evt_${identity}`,
              projectId: plan.projectId,
              runId: `run_${identity}`,
              sessionId: `ses_${identity}`,
              type: "knowledge.materialization.applied",
              occurredAt: applied.appliedAt,
              actor: { kind: "user" },
              schemaVersion: 1,
              policyVersion: plan.policyHash,
              payload: {
                operation: `document_structure_${structure.operation}`,
                planId: plan.planId,
                sourceSnapshotId: plan.sourceSnapshotId,
                policyHash: plan.policyHash,
                compilerId: "lervo.document-structure",
                compilerVersion: "1",
                approvalDigest: plan.approvalHash,
                coverage: plan.coverage,
                bundleIds: [],
                createdConceptIds: created.slice(0, 256),
                updatedConceptIds: updated.slice(0, 256),
                deprecatedConceptIds: deprecated.slice(0, 256),
                conceptListTruncated: created.length + updated.length + deprecated.length > 256,
                resultArtifactId: null,
                resultArtifactHash: null,
                createdCount: counts.created,
                updatedCount: counts.updated,
                unchangedCount: counts.unchanged,
                beforeRegistryDigest: plan.registryDigest,
                afterRegistryDigest: plan.afterRegistryDigest,
                validationReportId: `klint_${validationArtifact.contentHash.slice("sha256:".length, "sha256:".length + 24)}`,
                validationReportHash: validationArtifact.contentHash,
                appliedAt: applied.appliedAt,
              },
            });
          },
        });
      },
    });
    input.io.stdout(
      input.json
        ? `${JSON.stringify({ ...receipt, notice: report }, null, 2)}\n`
        : `${structure.describe(receipt)}\n${crossCheckedEffectLines(report).join("\n")}\n`,
    );
  } finally {
    await storage.close();
  }
  return 0;
}
