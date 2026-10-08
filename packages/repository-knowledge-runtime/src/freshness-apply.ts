import {
  activeDocumentFreshnessHold,
  canonicalJson,
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
import { listFreshnessHolds, writeFreshnessCandidate } from "./freshness-state-store.js";
import { freshnessDependenciesCurrent } from "./freshness-dependencies.js";

async function assertFreshnessDependencies(input: {
  storage: FreshnessStorage;
  candidate: DocumentFreshnessCandidateV1;
  now: Date;
}): Promise<void> {
  if (
    input.candidate.dependencyWitness === undefined ||
    (await freshnessDependenciesCurrent(
      input.storage.paths.repositoryRoot,
      input.candidate.dependencyWitness,
    ))
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

/** Commits, stores, and records one apply; the written bytes are already in place. */
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
    subject: `docs: refresh ${candidate.documentPath} from evidence`,
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

/** Lervo applies its own verified hunks: Lervo-managed, no authority, no pending cross-check. */
export async function applyLervoManagedFreshnessHunks(input: {
  storage: FreshnessStorage;
  candidate: DocumentFreshnessCandidateV1;
  hunkIds: ReadonlySet<string>;
  now: Date;
}): Promise<DocumentFreshnessCandidateV1> {
  return applyEdit({
    ...input,
    approval: {
      approvalSource: "lervo_managed",
      approvalRef: sha256(
        canonicalJson({
          candidateId: input.candidate.candidateId,
          hunks: [...input.hunkIds].sort(),
        }),
      ),
      reviewer: null,
      approvedAt: input.now.toISOString(),
    },
  });
}

const OWNER_REVIEWABLE = new Set<DocumentFreshnessCandidateV1["state"]>([
  "waiting_authority",
  "verified_pending_cross_check",
  "partially_applied",
]);

/**
 * Owner apply: binds the candidate and its verified output hash. It applies every pending hunk, or
 * the archive, and fails with `approval_mismatch`, `source_changed`, or `freshness_hold_active`
 * without writing.
 */
export async function applyFreshnessCandidateByOwner(input: {
  storage: FreshnessStorage;
  candidate: DocumentFreshnessCandidateV1;
  approvalHash: string;
  reviewer: string | null;
  now: Date;
}): Promise<DocumentFreshnessCandidateV1> {
  const { candidate } = input;
  if (!OWNER_REVIEWABLE.has(candidate.state) || candidate.afterHash === null)
    throw new DocumentFreshnessOperationError(
      "candidate_not_reviewable",
      `Candidate ${candidate.candidateId} is ${candidate.state}; only candidates awaiting review can be applied.`,
    );
  if (input.approvalHash !== candidate.afterHash)
    throw new DocumentFreshnessOperationError(
      "approval_mismatch",
      `The approval must equal the verified output hash ${candidate.afterHash}.`,
    );
  const hold = activeDocumentFreshnessHold(
    await listFreshnessHolds(input.storage.paths.repositoryRoot),
    candidate,
    input.now,
  );
  if (hold !== null)
    throw new DocumentFreshnessOperationError(
      "freshness_hold_active",
      `${candidate.documentPath} is on a freshness hold until ${hold.until}.`,
    );
  const approval: DocumentFreshnessApproval = {
    approvalSource: "owner",
    approvalRef: sha256(
      canonicalJson({
        candidateId: candidate.candidateId,
        afterHash: candidate.afterHash,
        reviewer: input.reviewer,
      }),
    ),
    reviewer: input.reviewer,
    approvedAt: input.now.toISOString(),
  };
  if (candidate.operation === "archive" && candidate.archive !== null) {
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
        approval,
        acknowledgedAt: null,
        updatedAt: input.now.toISOString(),
      },
    });
  }
  if (candidate.operation !== "edit" || candidate.pendingHunkIds.length === 0)
    throw new DocumentFreshnessOperationError(
      "candidate_not_reviewable",
      `Candidate ${candidate.candidateId} has no pending change to apply.`,
    );
  return applyEdit({
    storage: input.storage,
    candidate,
    hunkIds: new Set(candidate.pendingHunkIds),
    approval,
    now: input.now,
  });
}
