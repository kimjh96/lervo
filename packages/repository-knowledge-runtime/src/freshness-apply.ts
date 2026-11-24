import {
  canonicalJson,
  documentFreshnessCrossCheckNotice,
  documentFreshnessSelectedOutput,
  sha256,
  type DocumentFreshnessApproval,
  type DocumentFreshnessCandidateV1,
} from "@lervo/repository-knowledge";

import { writeFreshnessArchive } from "./freshness-archive-apply.js";
import { committedBlob, commitFreshnessPaths } from "./freshness-commit.js";
import {
  currentDocumentBytes,
  DocumentFreshnessOperationError,
  writeDocumentBytes,
  type FreshnessStorage,
} from "./freshness-document-io.js";
import { appendFreshnessEvent, recordFreshnessRejection } from "./freshness-events.js";
import { writeFreshnessCandidate } from "./freshness-state-store.js";
import { freshnessDependenciesCurrent } from "./freshness-dependencies.js";

/** ADR-0631: every record a reverse header candidate cites still has the bytes it was built from. */
async function declaringRecordsCurrent(
  root: string,
  candidate: DocumentFreshnessCandidateV1,
): Promise<boolean> {
  for (const [path, hash] of Object.entries(candidate.mechanical?.declaringHashes ?? {})) {
    const bytes = await committedBlob(root, path);
    if (bytes === null || sha256(bytes) !== hash) return false;
  }
  return true;
}

async function assertFreshnessDependencies(input: {
  storage: FreshnessStorage;
  candidate: DocumentFreshnessCandidateV1;
  now: Date;
}): Promise<void> {
  const root = input.storage.paths.repositoryRoot;
  if (
    (input.candidate.dependencyWitness === undefined ||
      (await freshnessDependenciesCurrent(root, input.candidate.dependencyWitness))) &&
    (await declaringRecordsCurrent(root, input.candidate))
  )
    return;
  await supersedeFreshnessCandidate(input);
  throw new DocumentFreshnessOperationError(
    "source_changed",
    "Reviewed freshness evidence changed before apply.",
  );
}

/**
 * Supersedes a candidate whose source bytes changed under it. `source_changed` means the owner
 * or another writer moved first; the candidate never applies and a new one follows next cycle.
 */
export async function supersedeFreshnessCandidate(input: {
  storage: FreshnessStorage;
  candidate: DocumentFreshnessCandidateV1;
  now: Date;
}): Promise<DocumentFreshnessCandidateV1> {
  const superseded: DocumentFreshnessCandidateV1 = {
    ...input.candidate,
    state: "superseded",
    rejection: {
      reasonCode: "source_changed",
      rejectorKind: "deterministic",
      contestedHunkIds: [],
    },
    updatedAt: input.now.toISOString(),
  };
  await writeFreshnessCandidate(input.storage.paths.repositoryRoot, superseded);
  recordFreshnessRejection({
    storage: input.storage,
    candidate: superseded,
    occurredAt: superseded.updatedAt,
  });
  return superseded;
}

/**
 * Commits, stores, and records one apply; the written bytes are already in place. The commit
 * carries the ADR-0561 notice fields as trailers, so the after-the-fact notice reads them from Git.
 */
async function settleFreshnessApply(input: {
  storage: FreshnessStorage;
  candidate: DocumentFreshnessCandidateV1;
  paths: readonly string[];
  subject: string;
  beforeHash: string;
  next: Omit<DocumentFreshnessCandidateV1, "commitHash">;
  appliedHunkCount: number;
}): Promise<DocumentFreshnessCandidateV1> {
  const commitHash = await commitFreshnessPaths({
    repositoryRoot: input.storage.paths.repositoryRoot,
    paths: input.paths,
    subject: input.subject,
    trailer: { key: "Lervo-Freshness-Candidate", candidateId: input.candidate.candidateId },
    extraTrailers: [
      [
        "Lervo-Freshness-Reason",
        input.candidate.mechanical?.kind === "reverse_header"
          ? "reverse_header"
          : input.candidate.reasonsAddressed.join(", ") || "none",
      ],
      ["Lervo-Freshness-Cross-Check", documentFreshnessCrossCheckNotice(input.candidate)],
    ],
  });
  const next: DocumentFreshnessCandidateV1 = { ...input.next, commitHash };
  await writeFreshnessCandidate(input.storage.paths.repositoryRoot, next);
  appendFreshnessEvent({
    storage: input.storage,
    type: "document.freshness.candidate.applied",
    correlationId: next.candidateId,
    coordinate: [input.beforeHash, next.appliedHash],
    occurredAt: next.updatedAt,
    payload: {
      candidateId: next.candidateId,
      documentPath: next.documentPath,
      beforeHash: input.beforeHash,
      afterHash: next.appliedHash,
      appliedHunkCount: input.appliedHunkCount,
      pendingHunkCount: next.pendingHunkIds.length,
      approvalSource: next.approval!.approvalSource,
      approvalRef: next.approval!.approvalRef,
      commitHash,
      occurredAt: next.updatedAt,
    },
  });
  return next;
}

async function applyEdit(input: {
  storage: FreshnessStorage;
  candidate: DocumentFreshnessCandidateV1;
  hunkIds: ReadonlySet<string>;
  approval: DocumentFreshnessApproval;
  now: Date;
}): Promise<DocumentFreshnessCandidateV1> {
  const root = input.storage.paths.repositoryRoot;
  const { candidate } = input;
  const expected = candidate.appliedHash ?? candidate.sourceHash;
  const bytes = await currentDocumentBytes(root, candidate.documentPath);
  // Only committed bytes are refreshed, so a freshness commit never carries an uncommitted edit.
  const committed =
    candidate.appliedHash === null ? await committedBlob(root, candidate.documentPath) : bytes;
  if (
    bytes === null ||
    sha256(bytes) !== expected ||
    committed === null ||
    sha256(committed) !== expected
  ) {
    await supersedeFreshnessCandidate(input);
    throw new DocumentFreshnessOperationError(
      "source_changed",
      `${candidate.documentPath} changed or has uncommitted edits after candidate ${candidate.candidateId} was verified.`,
    );
  }
  const beforeBytesRef =
    candidate.beforeBytesRef ?? (await input.storage.artifacts.put(new Uint8Array(bytes))).uri;
  const output = documentFreshnessSelectedOutput({
    documentPath: candidate.documentPath,
    original:
      candidate.appliedHash === null
        ? new Uint8Array(bytes)
        : await input.storage.artifacts.get(beforeBytesRef),
    current: new Uint8Array(bytes),
    hunks: candidate.hunks,
    appliedHunkIds: new Set(candidate.appliedHunkIds),
    newHunkIds: input.hunkIds,
  });
  await assertFreshnessDependencies(input);
  try {
    await writeDocumentBytes(root, candidate.documentPath, output);
  } catch (error) {
    await writeDocumentBytes(root, candidate.documentPath, bytes).catch(() => undefined);
    const failed: DocumentFreshnessCandidateV1 = {
      ...candidate,
      beforeBytesRef,
      state: "rejected",
      rejection: {
        reasonCode: "write_failed",
        rejectorKind: "deterministic",
        contestedHunkIds: [],
      },
      updatedAt: input.now.toISOString(),
    };
    await writeFreshnessCandidate(root, failed);
    recordFreshnessRejection({
      storage: input.storage,
      candidate: failed,
      occurredAt: failed.updatedAt,
    });
    throw new DocumentFreshnessOperationError(
      "write_failed",
      "The refreshed document could not be written.",
      { cause: error },
    );
  }
  const pending = candidate.pendingHunkIds.filter((id) => !input.hunkIds.has(id));
  return settleFreshnessApply({
    storage: input.storage,
    candidate,
    paths: [candidate.documentPath],
    subject:
      candidate.mechanical?.kind === "reverse_header"
        ? `docs: add reverse header lines to ADR-${candidate.mechanical.adr}`
        : `docs: refresh ${candidate.documentPath} from evidence`,
    beforeHash: expected,
    appliedHunkCount: input.hunkIds.size,
    next: {
      ...candidate,
      beforeBytesRef,
      appliedHash: sha256(output),
      appliedHunkIds: [
        ...candidate.appliedHunkIds,
        ...candidate.hunks
          .filter((hunk) => input.hunkIds.has(hunk.hunkId))
          .map((hunk) => hunk.hunkId),
      ],
      pendingHunkIds: pending,
      state: pending.length === 0 ? "applied" : "partially_applied",
      approval: input.approval,
      acknowledgedAt: null,
      updatedAt: input.now.toISOString(),
    },
  });
}

/**
 * The record of Lervo's own apply (ADR-0561): no owner or mandate authority, bound to the applied
 * hunks and to the agreeing cross-check runs, which are named as the reviewer.
 */
function lervoApproval(
  candidate: DocumentFreshnessCandidateV1,
  hunkIds: readonly string[],
  now: Date,
): DocumentFreshnessApproval {
  const runs = [...(candidate.crossCheckRounds ?? []), candidate.crossCheckReview]
    .filter((round) => round?.outcome === "agreement")
    .map((round) => round!.runId)
    .filter((runId): runId is string => runId !== null);
  return {
    approvalSource: "lervo_managed",
    approvalRef: sha256(
      canonicalJson({ candidateId: candidate.candidateId, hunks: [...hunkIds].sort(), runs }),
    ),
    reviewer: runs.length === 0 ? null : `cross_check ${runs.join(",")}`,
    approvedAt: now.toISOString(),
  };
}

/** Lervo applies verified edit hunks that need no cross-check or have its required agreement. */
export async function applyLervoManagedFreshnessHunks(input: {
  storage: FreshnessStorage;
  candidate: DocumentFreshnessCandidateV1;
  hunkIds: ReadonlySet<string>;
  now: Date;
}): Promise<DocumentFreshnessCandidateV1> {
  return applyEdit({
    ...input,
    approval: lervoApproval(input.candidate, [...input.hunkIds], input.now),
  });
}

/**
 * Lervo applies a verified archive after two agreeing cross-checks (ADR-0561): the move with its
 * banner, the inbound link rewrites, and one commit. The CAS pre-image makes it revertible.
 */
export async function applyVerifiedFreshnessArchive(input: {
  storage: FreshnessStorage;
  candidate: DocumentFreshnessCandidateV1;
  now: Date;
}): Promise<DocumentFreshnessCandidateV1> {
  const { candidate } = input;
  if (
    candidate.operation !== "archive" ||
    candidate.archive === null ||
    candidate.state !== "verified"
  )
    throw new DocumentFreshnessOperationError(
      "candidate_not_reviewable",
      `Candidate ${candidate.candidateId} is not a verified archive.`,
    );
  await assertFreshnessDependencies(input);
  let written: Awaited<ReturnType<typeof writeFreshnessArchive>>;
  try {
    written = await writeFreshnessArchive({ storage: input.storage, candidate });
  } catch (error) {
    if (error instanceof DocumentFreshnessOperationError && error.code === "source_changed")
      await supersedeFreshnessCandidate(input);
    throw error;
  }
  return settleFreshnessApply({
    storage: input.storage,
    candidate,
    paths: written.paths,
    subject: `docs: archive ${candidate.documentPath} as historical`,
    beforeHash: candidate.sourceHash,
    appliedHunkCount: 0,
    next: {
      ...candidate,
      beforeBytesRef: written.preimageRef,
      appliedHash: written.appliedHash,
      state: "applied",
      approval: lervoApproval(candidate, [], input.now),
      acknowledgedAt: null,
      updatedAt: input.now.toISOString(),
    },
  });
}
