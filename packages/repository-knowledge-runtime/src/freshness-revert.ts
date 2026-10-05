import { sha256, type DocumentFreshnessCandidateV1 } from "@lervo/repository-knowledge";

import { restoreFreshnessArchive } from "./freshness-archive-apply.js";
import { commitFreshnessPaths } from "./freshness-commit.js";
import {
  currentDocumentBytes,
  DocumentFreshnessOperationError,
  writeDocumentBytes,
  type FreshnessStorage,
} from "./freshness-document-io.js";
import { appendFreshnessEvent } from "./freshness-events.js";
import { writeFreshnessCandidate, writeFreshnessHold } from "./freshness-state-store.js";

/**
 * Restores the exact before-bytes when the document still holds what the candidate wrote, commits
 * the restore with `Lervo-Freshness-Revert`, records `reverted`, and holds the finding so the loop
 * never contends with the owner. A later edit fails with `revert_conflict` and changes nothing.
 */
export async function revertFreshnessCandidate(input: {
  storage: FreshnessStorage;
  candidate: DocumentFreshnessCandidateV1;
  revertedBy: "owner" | "agent";
  holdDays: number;
  now: Date;
}): Promise<DocumentFreshnessCandidateV1> {
  const root = input.storage.paths.repositoryRoot;
  const { candidate } = input;
  if (
    (candidate.state !== "applied" && candidate.state !== "partially_applied") ||
    candidate.beforeBytesRef === null ||
    candidate.appliedHash === null
  )
    throw new DocumentFreshnessOperationError(
      "candidate_not_reviewable",
      `Candidate ${candidate.candidateId} is ${candidate.state}; only applied candidates can be reverted.`,
    );
  let paths: string[];
  if (candidate.operation === "archive" && candidate.archive !== null)
    paths = await restoreFreshnessArchive(input);
  else {
    const current = await currentDocumentBytes(root, candidate.documentPath);
    if (current === null || sha256(current) !== candidate.appliedHash)
      throw new DocumentFreshnessOperationError(
        "revert_conflict",
        `Reconcile by hand: ${candidate.documentPath} (current), the before-bytes in ${candidate.beforeBytesRef}, and the applied output ${candidate.appliedHash} differ.`,
      );
    await writeDocumentBytes(
      root,
      candidate.documentPath,
      await input.storage.artifacts.get(candidate.beforeBytesRef),
    );
    paths = [candidate.documentPath];
  }
  await commitFreshnessPaths({
    repositoryRoot: root,
    paths,
    subject: `docs: revert freshness refresh of ${candidate.documentPath}`,
    trailer: { key: "Lervo-Freshness-Revert", candidateId: candidate.candidateId },
  });
  const holdUntil = new Date(input.now.getTime() + input.holdDays * 86_400_000).toISOString();
  await writeFreshnessHold(root, {
    schemaVersion: 1,
    findingDigest: candidate.findingDigest,
    documentPath: candidate.documentPath,
    candidateId: candidate.candidateId,
    reason: "reverted",
    until: holdUntil,
  });
  const next: DocumentFreshnessCandidateV1 = {
    ...candidate,
    state: "reverted",
    updatedAt: input.now.toISOString(),
  };
  await writeFreshnessCandidate(root, next);
  appendFreshnessEvent({
    storage: input.storage,
    type: "document.freshness.candidate.reverted",
    correlationId: candidate.candidateId,
    coordinate: candidate.appliedHash,
    occurredAt: next.updatedAt,
    payload: {
      candidateId: candidate.candidateId,
      documentPath: candidate.documentPath,
      restoredHash: candidate.sourceHash,
      revertedBy: input.revertedBy,
      holdUntil,
      occurredAt: next.updatedAt,
    },
  });
  return next;
}
