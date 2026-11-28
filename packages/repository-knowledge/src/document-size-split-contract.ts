// ADR-0653: the exact plan and receipt of a document size split.
import type { DurableKnowledgeUserFileOperation } from "./durable-apply.js";
import type { KnowledgeFileOperation, RepositoryKnowledgeScan } from "./types.js";

export interface DocumentSizeSplitDocument {
  path: string;
  beforeHash: string;
  beforeByteCount: number;
  afterHash: string;
  afterByteCount: number;
  parts: Array<{
    path: string;
    title: string | null;
    startByte: number;
    endByte: number;
    contentHash: string;
    byteCount: number;
    /** A table's header rows repeated ahead of the part, which reassembly removes. */
    repeatedHeaderBytes: number;
    /** Relative Markdown links rebased to the part's directory. */
    rebasedLinks: number;
  }>;
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
  /** Parts that are one block larger than the bound; normalization reports and skips them. */
  unsplittable: Array<{ path: string; byteCount: number }>;
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
