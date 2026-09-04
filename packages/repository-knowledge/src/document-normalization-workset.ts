import { canonicalJson, stableId } from "./integrity.js";
import { RepositoryKnowledgeError } from "./types.js";

import type {
  DocumentNormalizationCompilerDescriptor,
  DocumentNormalizationEnvelope,
} from "./document-normalization.js";

export type DocumentNormalizationScope = "all_pending" | "stale";

export interface DocumentNormalizationWorksetBinding {
  worksetId: string;
  scope: DocumentNormalizationScope;
  repository: {
    eligibleDocuments: number;
    currentDocuments: number;
    pendingDocuments: number;
    staleDocuments: number;
    unrecordedDocuments: number;
  };
  selectedDocuments: number;
  sourceBytes: number;
  complete: true;
}

export interface DocumentNormalizationResourceCeilings {
  maximumSourceBytes: number;
  maximumProviderCalls: number;
}

export interface DocumentNormalizationPreflight {
  schemaVersion: 1;
  planKind: "document_normalization_preflight";
  status: "current" | "ready" | "blocked";
  workset: DocumentNormalizationWorksetBinding;
  sourceSnapshotId: string;
  outputLanguage: string;
  formatVersion: "lervo.document.v1";
  compiler: DocumentNormalizationCompilerDescriptor;
  selection: {
    documents: Array<{
      path: string;
      contentHash: string;
      byteCount: number;
      lifecycle: "stale" | "unrecorded";
      cache: "hit" | "miss";
    }>;
    envelopeCount: number;
    cacheHits: number;
    cacheMisses: number;
    providerCallCapacity: number;
  };
  ceilings: DocumentNormalizationResourceCeilings;
  blockers: Array<{
    code: "source_bytes_exceeded" | "provider_calls_exceeded";
    observed: number;
    limit: number;
  }>;
}

export const defaultDocumentNormalizationResourceCeilings = {
  maximumSourceBytes: 1024 * 1024,
  maximumProviderCalls: 256,
} as const satisfies DocumentNormalizationResourceCeilings;

export function selectDocumentNormalizationPaths(input: {
  scope: DocumentNormalizationScope;
  pendingPaths: ReadonlySet<string>;
  stalePaths: ReadonlySet<string>;
}): Set<string> {
  return new Set(
    [...input.pendingPaths]
      .filter((path) => input.scope === "all_pending" || input.stalePaths.has(path))
      .sort(),
  );
}

export function documentNormalizationWorksetBinding(input: {
  scope: DocumentNormalizationScope;
  sourceSnapshotId: string;
  eligibleDocuments: number;
  currentDocuments: number;
  pendingDocuments: number;
  staleDocuments: number;
  documents: ReadonlyArray<{ path: string; contentHash: string; byteCount: number }>;
}): DocumentNormalizationWorksetBinding {
  const documents = [...input.documents].sort((left, right) => left.path.localeCompare(right.path));
  const counts = [
    input.eligibleDocuments,
    input.currentDocuments,
    input.pendingDocuments,
    input.staleDocuments,
  ];
  if (
    counts.some((count) => !Number.isSafeInteger(count) || count < 0) ||
    input.currentDocuments + input.pendingDocuments !== input.eligibleDocuments ||
    input.staleDocuments > input.pendingDocuments ||
    documents.some(
      (document) =>
        typeof document.path !== "string" ||
        document.path.length < 1 ||
        !/^sha256:[a-f0-9]{64}$/u.test(document.contentHash) ||
        !Number.isSafeInteger(document.byteCount) ||
        document.byteCount < 1,
    ) ||
    new Set(documents.map((document) => document.path)).size !== documents.length ||
    documents.length !== (input.scope === "stale" ? input.staleDocuments : input.pendingDocuments)
  )
    throw new RepositoryKnowledgeError(
      "knowledge_compile_policy_violation",
      "The document normalization workset counts or source bindings are inconsistent.",
    );
  const sourceBytes = documents.reduce((sum, document) => sum + document.byteCount, 0);
  const repository = {
    eligibleDocuments: input.eligibleDocuments,
    currentDocuments: input.currentDocuments,
    pendingDocuments: input.pendingDocuments,
    staleDocuments: input.staleDocuments,
    unrecordedDocuments: input.pendingDocuments - input.staleDocuments,
  };
  return {
    worksetId: stableId("knormset", {
      scope: input.scope,
      sourceSnapshotId: input.sourceSnapshotId,
      repository,
      documents,
    }),
    scope: input.scope,
    repository,
    selectedDocuments: documents.length,
    sourceBytes,
    complete: true,
  };
}

export async function createDocumentNormalizationPreflightReport(input: {
  binding: DocumentNormalizationWorksetBinding;
  sourceSnapshotId: string;
  outputLanguage: string;
  compiler: DocumentNormalizationCompilerDescriptor;
  envelopes: readonly DocumentNormalizationEnvelope[];
  lifecycleByPath: ReadonlyMap<string, "stale" | "unrecorded">;
  isCached: (envelope: DocumentNormalizationEnvelope) => Promise<boolean>;
  ceilings?: Partial<DocumentNormalizationResourceCeilings>;
}): Promise<DocumentNormalizationPreflight> {
  const envelopeDocuments = input.envelopes.flatMap((envelope) => envelope.documents);
  const rebound = documentNormalizationWorksetBinding({
    scope: input.binding.scope,
    sourceSnapshotId: input.sourceSnapshotId,
    ...input.binding.repository,
    documents: envelopeDocuments.map((document) => ({
      path: document.path,
      contentHash: document.contentHash,
      byteCount: Buffer.byteLength(document.untrustedSourceData),
    })),
  });
  if (
    canonicalJson(rebound) !== canonicalJson(input.binding) ||
    input.envelopes.some(
      (envelope) =>
        envelope.sourceSnapshotId !== input.sourceSnapshotId ||
        envelope.outputLanguage !== input.outputLanguage ||
        envelope.formatVersion !== "lervo.document.v1",
    ) ||
    envelopeDocuments.some((document) => !input.lifecycleByPath.has(document.path))
  )
    throw new RepositoryKnowledgeError(
      "knowledge_compile_policy_violation",
      "The document normalization preflight does not match its workset, lifecycle, or envelope boundary.",
    );
  const ceilings = {
    ...defaultDocumentNormalizationResourceCeilings,
    ...input.ceilings,
  };
  if (
    !Number.isSafeInteger(ceilings.maximumSourceBytes) ||
    ceilings.maximumSourceBytes < 1 ||
    !Number.isSafeInteger(ceilings.maximumProviderCalls) ||
    ceilings.maximumProviderCalls < 1
  )
    throw new RepositoryKnowledgeError(
      "knowledge_compile_policy_violation",
      "Document normalization resource ceilings must be positive safe integers.",
    );
  const documents: DocumentNormalizationPreflight["selection"]["documents"] = [];
  let providerCallCapacity = 0;
  for (const envelope of input.envelopes) {
    let misses = 0;
    for (const document of envelope.documents) {
      const cached = await input.isCached({ ...envelope, documents: [document] });
      if (!cached) misses += 1;
      documents.push({
        path: document.path,
        contentHash: document.contentHash,
        byteCount: Buffer.byteLength(document.untrustedSourceData),
        lifecycle: input.lifecycleByPath.get(document.path)!,
        cache: cached ? "hit" : "miss",
      });
    }
    if (misses > 0) providerCallCapacity += misses === 1 ? 1 : misses + 1;
  }
  documents.sort((left, right) => left.path.localeCompare(right.path));
  const cacheHits = documents.filter((document) => document.cache === "hit").length;
  const cacheMisses = documents.length - cacheHits;
  const blockers: DocumentNormalizationPreflight["blockers"] = [];
  if (input.binding.sourceBytes > ceilings.maximumSourceBytes)
    blockers.push({
      code: "source_bytes_exceeded",
      observed: input.binding.sourceBytes,
      limit: ceilings.maximumSourceBytes,
    });
  if (providerCallCapacity > ceilings.maximumProviderCalls)
    blockers.push({
      code: "provider_calls_exceeded",
      observed: providerCallCapacity,
      limit: ceilings.maximumProviderCalls,
    });
  return {
    schemaVersion: 1,
    planKind: "document_normalization_preflight",
    status: blockers.length > 0 ? "blocked" : documents.length === 0 ? "current" : "ready",
    workset: input.binding,
    sourceSnapshotId: input.sourceSnapshotId,
    outputLanguage: input.outputLanguage,
    formatVersion: "lervo.document.v1",
    compiler: input.compiler,
    selection: {
      documents,
      envelopeCount: input.envelopes.length,
      cacheHits,
      cacheMisses,
      providerCallCapacity,
    },
    ceilings,
    blockers,
  };
}

export function assertDocumentNormalizationPreflightReady(
  preflight: DocumentNormalizationPreflight,
): void {
  if (preflight.status !== "blocked") return;
  const summary = preflight.blockers
    .map((blocker) => `${blocker.code} (${blocker.observed} > ${blocker.limit})`)
    .join(", ");
  throw new RepositoryKnowledgeError(
    "normalization_budget_exceeded",
    `Document normalization resource ceiling exceeded: ${summary}.`,
  );
}
