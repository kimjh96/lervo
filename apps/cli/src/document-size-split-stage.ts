// ADR-0653: the `lervo migrate knowledge` stage that splits documents too large to normalize in
// one pass, before normalization. Its check is deterministic, so no provider reviews it: the
// planned index and parts must split again identically from the document's current bytes.
import {
  applyDocumentSizeSplitPlan,
  createDocumentSizeSplitPlan,
  documentSizeSplitSummary,
  inspectConfiguredDocumentNormalization,
  verifyDocumentSizeSplitPlan,
  type DocumentSizeSplitPlan,
  type DocumentSizeSplitReceipt,
  type RepositoryKnowledgeScan,
  type RepositorySupplementalSource,
} from "@lervo/repository-knowledge";

import { applyDocumentStructureOperation } from "./document-structure-apply.js";
import type { CrossCheckPlan } from "./plan-cross-check.js";
import type { CliIo } from "./types.js";

/** Who stands in for the reviewer of a size split, as the notice and the commit name it. */
export const DOCUMENT_SIZE_SPLIT_VERIFIER = "deterministic byte verifier";

/** The cross-check of a size split: the plan must split again identically from current bytes. */
export const verifyDocumentSizeSplit: CrossCheckPlan = async ({ plan }) => {
  const verdict = await verifyDocumentSizeSplitPlan(plan as DocumentSizeSplitPlan);
  return {
    verdict: verdict.agreed ? "agree" : "disagree",
    rationale: verdict.rationale,
    reviewer: DOCUMENT_SIZE_SPLIT_VERIFIER,
  };
};

function printable(plan: DocumentSizeSplitPlan): unknown {
  return {
    ...plan,
    operations: plan.operations.map(({ content: _content, ...operation }) => operation),
  };
}

function formatPlan(plan: DocumentSizeSplitPlan): string {
  const lines = [
    `Documents too large to normalize in one pass (over ${plan.boundBytes} bytes) split first.`,
    `plan: ${plan.planId}`,
    ...documentSizeSplitSummary(plan),
    ...plan.unsplittable.map(
      (part) => `unsplittable: ${part.path} (${part.byteCount} bytes, document_unsplittable)`,
    ),
    ...plan.deferred.map(
      (document) => `deferred: ${document.path} (${document.byteCount} bytes, not yet registered)`,
    ),
    ...plan.data.map(
      (document) => `data: ${document.path} (${document.byteCount} bytes, document_too_large)`,
    ),
    "Every byte is kept: the parts are exact ranges of each document, checked deterministically.",
    `Apply with lervo migrate knowledge --apply ${plan.planId}.`,
  ];
  return `${lines.join("\n")}\n`;
}

/**
 * Plans, or with `applyPlanId` applies, the split of every document normalization found over the
 * single-pass bound. Null when no document needs a split, so the next stage runs.
 */
export async function runDocumentSizeSplitStage(input: {
  repositoryRoot: string;
  supplementalSources: RepositorySupplementalSource[];
  /** The stage's scan, when the command has one; it spares a plan when nothing is large. */
  preparedScan?: RepositoryKnowledgeScan | undefined;
  applyPlanId?: string;
  json: boolean;
  io: CliIo;
}): Promise<number | null> {
  const normalization = await inspectConfiguredDocumentNormalization({
    repositoryRoot: input.repositoryRoot,
    supplementalSources: input.supplementalSources,
  });
  const sourcePaths = normalization.oversizedDocuments.map((document) => document.path);
  const unread = input.preparedScan?.sources.some(
    (source) => source.reason === "file_size_limit" && source.path.endsWith(".md"),
  );
  if (sourcePaths.length === 0 && unread === false) return null;
  const plan = await createDocumentSizeSplitPlan({
    repositoryRoot: input.repositoryRoot,
    sourcePaths,
    supplementalSources: input.supplementalSources,
  });
  if (plan.status === "current") {
    // Nothing to split, but what stays whole is named on every run, never passed silently.
    const kept = [...plan.data, ...plan.deferred].map(
      (document) =>
        `kept whole: ${document.path} (${document.byteCount} bytes, document_too_large)`,
    );
    if (kept.length > 0) input.io.stderr(`${kept.join("\n")}\n`);
    return null;
  }
  if (input.applyPlanId === undefined) {
    input.io.stdout(
      input.json ? `${JSON.stringify(printable(plan), null, 2)}\n` : formatPlan(plan),
    );
    return 0;
  }
  if (input.applyPlanId !== plan.planId)
    throw new Error("The requested plan ID does not match the current document size split plan.");
  const created = plan.operations.filter((operation) => operation.action === "create").length;
  const updated = plan.operations.filter((operation) => operation.action === "update").length;
  return applyDocumentStructureOperation<DocumentSizeSplitPlan, DocumentSizeSplitReceipt>({
    repositoryRoot: input.repositoryRoot,
    structure: {
      operation: "split",
      plan,
      reason: `split ${plan.documents.length} document(s) too large to normalize in one pass`,
      conceptIds: {
        created: plan.createdConceptIds,
        updated: plan.updatedConceptIds,
        deprecated: plan.deprecatedConceptIds,
      },
      counts: () => ({
        created,
        updated,
        unchanged: plan.operations.length - created - updated,
      }),
      apply: (approval) =>
        applyDocumentSizeSplitPlan({
          plan,
          sourcePaths,
          approvedOperationId: approval.approvedOperationId,
          approvedHash: approval.approvedHash,
          now: approval.now,
          supplementalSources: approval.supplementalSources,
          recordApplied: approval.recordApplied,
        }),
      describe: (receipt) =>
        `Split ${receipt.documentCount} document(s) into ${receipt.partCount} parts.\nRun lervo migrate knowledge again to normalize them.`,
    },
    supplementalSources: input.supplementalSources,
    json: input.json,
    io: input.io,
    crossCheckPlan: verifyDocumentSizeSplit,
  });
}
