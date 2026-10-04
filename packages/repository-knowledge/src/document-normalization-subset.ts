import {
  loadDocumentNormalizationCandidate,
  storeDocumentNormalizationCandidate,
} from "./document-normalization.js";
import { documentNormalizationWorksetBinding } from "./document-normalization-workset.js";
import { stableId } from "./integrity.js";
import { RepositoryKnowledgeError } from "./types.js";

/** Retains exact reviewed item bytes and approvals; rejected items never enter the apply candidate. */
export async function createStoredDocumentNormalizationSubsetCandidate(input: {
  repositoryRoot: string;
  candidateId: string;
  operationIds: string[];
}): Promise<Awaited<ReturnType<typeof loadDocumentNormalizationCandidate>>> {
  const candidate = await loadDocumentNormalizationCandidate(input);
  const selected = new Set(input.operationIds);
  if (
    selected.size !== input.operationIds.length ||
    selected.size === 0 ||
    input.operationIds.some((id) => !candidate.items.some((item) => item.operationId === id))
  )
    throw new RepositoryKnowledgeError(
      "knowledge_approval_required",
      "The accepted normalization item set is invalid.",
    );
  const items = candidate.items.filter((item) => selected.has(item.operationId));
  const workset = documentNormalizationWorksetBinding({
    scope: candidate.workset.scope,
    sourceSnapshotId: candidate.sourceSnapshotId,
    ...candidate.workset.repository,
    selectionPaths: items.map((item) => item.sourcePath),
    documents: items.map((item) => ({
      path: item.sourcePath,
      contentHash: item.sourceContentHash,
      byteCount: item.sourceByteCount,
    })),
  });
  const { candidateId: _candidateId, schemaVersion: _schemaVersion, ...original } = candidate;
  const materials = {
    ...original,
    items,
    workset,
    coverage: {
      eligibleDocuments: items.length,
      normalizedDocuments: items.length,
      sourceUnits: items.reduce((count, item) => count + item.sourceUnitVersionIds.length, 0),
      complete: true as const,
    },
  };
  const subset = {
    schemaVersion: 1 as const,
    candidateId: stableId("knorm", materials),
    ...materials,
  };
  await storeDocumentNormalizationCandidate({
    repositoryRoot: input.repositoryRoot,
    candidate: subset,
  });
  return subset;
}
