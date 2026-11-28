// ADR-0653: applying a document size split, and the deterministic check that stands in for a
// reviewer, since a provider review cannot take documents over 1 MiB.
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { authorizeCurrentRepositoryDocumentLayout } from "./document-layout-enforcement.js";
import type {
  DocumentSizeSplitPlan,
  DocumentSizeSplitReceipt,
} from "./document-size-split-contract.js";
import { createDocumentSizeSplitPlan } from "./document-size-split.js";
import { referenceUpdateRestores, splitDocumentFailure } from "./document-size-split-verify.js";
import { applyDurableKnowledgeOperations } from "./durable-apply.js";
import { RepositoryKnowledgeError, type RepositoryKnowledgeScanOptions } from "./types.js";

/**
 * The deterministic check that stands in for a reviewer. It never plans again: for every file the
 * plan writes it undoes the recorded link rewrites, drops the copied definitions, the managed
 * block, and a repeated table header, and compares what remains with the original byte range;
 * the ranges must cover each document in order. A linking document must restore to its bytes.
 * Files are read as bytes and decoded without dropping a byte order mark.
 */
export async function verifyDocumentSizeSplitPlan(plan: DocumentSizeSplitPlan): Promise<{
  agreed: boolean;
  rationale: string;
}> {
  const contents = new Map(
    plan.operations.flatMap((operation) =>
      operation.content === undefined ? [] : [[operation.path, operation.content] as const],
    ),
  );
  const disagree = (path: string, reason: string) => ({
    agreed: false,
    rationale: `${path} does not restore to its original bytes: ${reason}.`,
  });
  const read = async (path: string) =>
    (await readFile(resolve(plan.repositoryRoot, path))).toString("utf8");
  for (const document of plan.documents) {
    const failure = splitDocumentFailure(await read(document.path), document, contents);
    if (failure !== null) return disagree(failure.path, failure.reason);
  }
  for (const reference of plan.referenceUpdates)
    if (
      !referenceUpdateRestores(
        await read(reference.path),
        reference.beforeHash,
        contents.get(reference.path),
        reference.linkRewrites,
      )
    )
      return disagree(reference.path, "its only changes must be the recorded link rewrites");
  const parts = plan.documents.reduce((sum, document) => sum + document.parts.length, 0);
  return {
    agreed: true,
    rationale: `${plan.documents.length} document(s) restore exactly from their index and ${parts} parts once the recorded link rewrites, copied definitions, repeated table headers, and the managed block are undone; ${plan.referenceUpdates.length} linking document(s) differ only by their recorded link rewrites.`,
  };
}

export async function applyDocumentSizeSplitPlan(input: {
  plan: DocumentSizeSplitPlan;
  sourcePaths: readonly string[];
  approvedOperationId: string;
  approvedHash: string;
  now: Date;
  recordApplied: (receipt: DocumentSizeSplitReceipt) => void | Promise<void>;
  supplementalSources?: RepositoryKnowledgeScanOptions["supplementalSources"];
}): Promise<DocumentSizeSplitReceipt> {
  if (
    input.approvedOperationId !== input.plan.operationId ||
    input.approvedHash !== input.plan.approvalHash
  )
    throw new RepositoryKnowledgeError(
      "knowledge_approval_required",
      "A document size split requires its operation ID and exact approval hash.",
    );
  const current = await createDocumentSizeSplitPlan({
    repositoryRoot: input.plan.repositoryRoot,
    sourcePaths: input.sourcePaths,
    boundBytes: input.plan.boundBytes,
    ...(input.supplementalSources === undefined
      ? {}
      : { supplementalSources: input.supplementalSources }),
  });
  if (current.planId !== input.plan.planId)
    throw new RepositoryKnowledgeError(
      "knowledge_plan_stale",
      "A document, the registry, the policy, or the source snapshot changed after the split was planned.",
    );
  const receipt: DocumentSizeSplitReceipt = {
    schemaVersion: 1,
    type: "knowledge.materialization.applied",
    operation: "document_size_split",
    planId: current.planId,
    operationId: current.operationId,
    projectId: current.projectId,
    sourceSnapshotId: current.sourceSnapshotId,
    afterSourceSnapshotId: current.afterSourceSnapshotId,
    approvalHash: current.approvalHash,
    documentCount: current.documents.length,
    partCount: current.documents.reduce((sum, document) => sum + document.parts.length, 0),
    lineageIds: current.lineageIds,
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
  });
}

/** Paths of the plan's parts, for output that lists where a document went. */
export function documentSizeSplitSummary(plan: DocumentSizeSplitPlan): string[] {
  return plan.documents.map(
    (document) =>
      `${document.path} (${document.beforeByteCount} bytes) -> ${document.parts.length} parts in ${dirname(document.parts[0]!.path)}`,
  );
}
