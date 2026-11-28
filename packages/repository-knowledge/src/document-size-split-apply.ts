// ADR-0653: applying a document size split, and the deterministic check that stands in for a
// reviewer, since a provider review cannot take documents over 1 MiB.
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { authorizeCurrentRepositoryDocumentLayout } from "./document-layout-enforcement.js";
import { splitOversizedDocument } from "./document-size-split-layout.js";
import type {
  DocumentSizeSplitPlan,
  DocumentSizeSplitReceipt,
} from "./document-size-split-contract.js";
import { createDocumentSizeSplitPlan } from "./document-size-split.js";
import { applyDurableKnowledgeOperations } from "./durable-apply.js";
import { sha256 } from "./integrity.js";
import { RepositoryKnowledgeError, type RepositoryKnowledgeScanOptions } from "./types.js";

/**
 * The deterministic check that stands in for a reviewer: each document's current bytes split
 * again to exactly the planned index and parts, whose original ranges reassemble the document.
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
  for (const document of plan.documents) {
    const original = await readFile(resolve(plan.repositoryRoot, document.path), "utf8");
    if (sha256(original) !== document.beforeHash)
      return { agreed: false, rationale: `${document.path} changed after the split was planned.` };
    const split = splitOversizedDocument(document.path, original, plan.boundBytes);
    const planned = [document.path, ...document.parts.map((part) => part.path)];
    const expected = [split.index, ...split.parts.map((part) => part.content)];
    if (planned.some((path, index) => contents.get(path) !== expected[index]))
      return {
        agreed: false,
        rationale: `${document.path} does not split again to the planned index and parts.`,
      };
  }
  const parts = plan.documents.reduce((sum, document) => sum + document.parts.length, 0);
  return {
    agreed: true,
    rationale: `Every byte of ${plan.documents.length} document(s) is kept: their ${parts} parts are exact ranges of the original bytes, with only table header rows repeated and relative links rebased, and they split again identically.`,
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
