// ADR-0653: the exact plan and receipt of a document size split.
import type { DurableKnowledgeUserFileOperation } from "./durable-apply.js";
import type { KnowledgeFileOperation, RepositoryKnowledgeScan } from "./types.js";

/** What the check must undo in one written file to reach its original range. */
export interface DocumentSizeSplitRestoration {
  /** Table header rows copied ahead of the range, or null. */
  repeatedHeader: string | null;
  /** Reference definitions copied ahead of the file, so they take effect first, or "". */
  definitionsBefore: string;
  /** Reference definitions copied after the range, in the document's own file, or "". */
  definitionsAfter: string;
  /** Link destinations rewritten, at character offsets before rewriting. */
  linkRewrites: Array<{ start: number; end: number; before: string; after: string }>;
}

export interface DocumentSizeSplitDocument extends DocumentSizeSplitRestoration {
  path: string;
  beforeHash: string;
  beforeByteCount: number;
  afterHash: string;
  afterByteCount: number;
  /** Bytes of the preamble the document keeps; the parts follow it in order. */
  preambleByteCount: number;
  /** The Lervo-managed block after the preamble. */
  partsBlock: string;
  parts: Array<
    DocumentSizeSplitRestoration & {
      path: string;
      title: string | null;
      startByte: number;
      endByte: number;
      contentHash: string;
      byteCount: number;
    }
  >;
  /** Link destinations the split could not rewrite, named so none breaks silently. */
  unkeptLinks: string[];
}

/** Another document whose links into a split document follow the headings into its parts. */
export interface DocumentSizeSplitReferenceUpdate {
  path: string;
  beforeHash: string;
  afterHash: string;
  linkRewrites: DocumentSizeSplitRestoration["linkRewrites"];
  /** Links to a split document's heading that no file holds, named so none breaks silently. */
  unkeptLinks: string[];
}

export interface DocumentSizeSplitPlan {
  schemaVersion: 1;
  planKind: "document_size_split";
  planId: string;
  operationId: string;
  approvalHash: string;
  status: "review_required" | "current";
  projectId: string;
  repositoryRoot: string;
  sourceSnapshotId: string;
  afterSourceSnapshotId: string;
  policyHash: string;
  coverage: RepositoryKnowledgeScan["inventoryCoverage"];
  registryDigest: string;
  afterRegistryDigest: string;
  boundBytes: number;
  documents: DocumentSizeSplitDocument[];
  /**
   * Documents the plan leaves unsplit because their split failed its own check or a part path is
   * taken, with the reason; the other documents still split.
   */
  failed: Array<{ path: string; reason: string }>;
  /** Links of other documents to a split document's heading that no file holds. */
  unkeptReferences: Array<{ path: string; url: string }>;
  /** Other documents whose anchor links the split rewrites. */
  referenceUpdates: DocumentSizeSplitReferenceUpdate[];
  /**
   * Documents and parts kept whole over the bound: one indivisible block, or a split's own index.
   * Normalization reports and skips them; no later plan splits them again.
   */
  unsplittable: Array<{
    path: string;
    byteCount: number;
    reason: "document_unsplittable" | "document_parts_index";
  }>;
  /** Documents over the split maximum, treated as data and never normalized. */
  data: Array<{ path: string; byteCount: number }>;
  /** Documents not yet a registered user concept; the structural stage registers them first. */
  deferred: Array<{ path: string; byteCount: number }>;
  createdConceptIds: string[];
  updatedConceptIds: string[];
  deprecatedConceptIds: string[];
  lineageIds: string[];
  operations: Array<KnowledgeFileOperation | DurableKnowledgeUserFileOperation>;
}

export interface DocumentSizeSplitReceipt {
  schemaVersion: 1;
  type: "knowledge.materialization.applied";
  operation: "document_size_split";
  planId: string;
  operationId: string;
  projectId: string;
  sourceSnapshotId: string;
  afterSourceSnapshotId: string;
  approvalHash: string;
  documentCount: number;
  partCount: number;
  lineageIds: string[];
  appliedAt: string;
}
