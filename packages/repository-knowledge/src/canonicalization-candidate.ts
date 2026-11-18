import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  canonicalResponsibilityForPath,
  recommendedCanonicalRoot,
  sourceResponsibilityForPath,
} from "./canonicalization-responsibility.js";
import {
  canonicalizationCandidatePath,
  listCanonicalizationCandidates,
  MAXIMUM_CANONICALIZATION_SOURCE_BINDINGS,
  readCanonicalizationCandidate,
  writeCanonicalizationCandidateRecord,
  type CanonicalizationCandidateInspection,
  type CanonicalizationCandidateRecord,
  type StoredCanonicalizationOutcome,
} from "./canonicalization-candidate-record.js";
import {
  validateCanonicalizationOutcomeForChange,
  type CanonicalizationOutcome,
} from "./canonicalization-outcome.js";
import { sha256, stableId } from "./integrity.js";
import { RepositoryKnowledgeError } from "./types.js";

export type { CanonicalizationResponsibility } from "./canonicalization-responsibility.js";
export * from "./canonicalization-candidate-record.js";

export interface CanonicalizationAssessment {
  schemaVersion: 1;
  status: "current" | "candidate";
  changedPathCount: number;
  canonicalPathCount: number;
  candidate: CanonicalizationCandidateInspection | null;
}

const MAXIMUM_ACTIVE_CANDIDATES = 64;

export async function assessCanonicalization(input: {
  repositoryRoot: string;
  beforeRevision: string;
  afterRevision: string;
  beforeFiles: Readonly<Record<string, string>>;
  afterFiles: Readonly<Record<string, string>>;
  disposition: "canonical_sources_current" | "canonical_sources_updated" | "pending_user_approval";
  outcome?: CanonicalizationOutcome;
  now: Date;
}): Promise<CanonicalizationAssessment> {
  const paths = new Set([...Object.keys(input.beforeFiles), ...Object.keys(input.afterFiles)]);
  const changedPaths = [...paths]
    .filter((path) => input.beforeFiles[path] !== input.afterFiles[path])
    .sort();
  if (input.outcome !== undefined)
    validateCanonicalizationOutcomeForChange({
      outcome: input.outcome,
      disposition: input.disposition,
      beforeFiles: input.beforeFiles,
      afterFiles: input.afterFiles,
    });
  const canonicalResponsibilities = new Set(
    input.outcome === undefined
      ? changedPaths.flatMap((path) => {
          const responsibility = canonicalResponsibilityForPath(path);
          return responsibility === null ? [] : [responsibility];
        })
      : input.outcome.kind === "canonical_update"
        ? input.outcome.targets.flatMap((target) => {
            const responsibility = canonicalResponsibilityForPath(target.path);
            return responsibility === null ? [] : [responsibility];
          })
        : [],
  );
  const sourceBindings = changedPaths.flatMap((path) => {
    const responsibility = sourceResponsibilityForPath(path);
    if (responsibility === null || canonicalResponsibilityForPath(path) !== null) return [];
    if (canonicalResponsibilities.has(responsibility)) return [];
    return [
      {
        path,
        beforeHash: input.beforeFiles[path] ?? null,
        afterHash: input.afterFiles[path] ?? null,
        responsibility,
      },
    ];
  });
  if (sourceBindings.length > MAXIMUM_CANONICALIZATION_SOURCE_BINDINGS)
    throw new RepositoryKnowledgeError(
      "knowledge_source_limit_exceeded",
      `Canonicalization candidate exceeds ${MAXIMUM_CANONICALIZATION_SOURCE_BINDINGS} source bindings.`,
    );
  if (sourceBindings.length === 0)
    return {
      schemaVersion: 1,
      status: "current",
      changedPathCount: changedPaths.length,
      canonicalPathCount: canonicalResponsibilities.size,
      candidate: null,
    };
  const candidateId = stableId("kcanon", {
    beforeRevision: input.beforeRevision,
    afterRevision: input.afterRevision,
    sourceBindings,
    outcome: input.outcome ?? null,
  });
  // ADR-0561: `pending_user_approval` waits on no one; the background reviewer judges every
  // candidate. The disposition is kept only so stored declarations still parse.
  const record: CanonicalizationCandidateRecord = {
    schemaVersion: 1,
    candidateId,
    state: "candidate",
    beforeRevision: input.beforeRevision,
    afterRevision: input.afterRevision,
    sourceBindings,
    recommendedRoots: [
      ...new Set(sourceBindings.map((item) => recommendedCanonicalRoot(item.responsibility))),
    ].sort(),
    createdAt: input.now.toISOString(),
    ...(input.outcome === undefined
      ? {}
      : { outcome: input.outcome as StoredCanonicalizationOutcome }),
    review: null,
    promotion: null,
  };
  const candidates = await listCanonicalizationCandidates(input.repositoryRoot);
  const existing = candidates.find((item) => item.candidateId === candidateId);
  if (
    existing === undefined &&
    candidates.filter(
      (item) => item.observedState === "candidate" || item.observedState === "pending",
    ).length >= MAXIMUM_ACTIVE_CANDIDATES
  )
    throw new RepositoryKnowledgeError(
      "knowledge_source_limit_exceeded",
      `The canonicalization candidate registry has ${MAXIMUM_ACTIVE_CANDIDATES} active records.`,
    );
  if (existing === undefined)
    await writeCanonicalizationCandidateRecord(resolve(input.repositoryRoot), record);
  const candidate =
    existing ??
    (await readCanonicalizationCandidate(
      resolve(input.repositoryRoot),
      canonicalizationCandidatePath(candidateId),
    ));
  return {
    schemaVersion: 1,
    status: "candidate",
    changedPathCount: changedPaths.length,
    canonicalPathCount: canonicalResponsibilities.size,
    candidate,
  };
}

export async function transitionCanonicalizationCandidate(input: {
  repositoryRoot: string;
  candidateId: string;
  expectedContentHash: string;
  action: "defer" | "reject" | "promote";
  reviewerId: string;
  targetPath?: string;
  targetContentHash?: string;
  now: Date;
}): Promise<CanonicalizationCandidateInspection> {
  const root = resolve(input.repositoryRoot);
  const current = (await listCanonicalizationCandidates(root)).find(
    (item) => item.candidateId === input.candidateId,
  );
  if (current === undefined || current.contentHash !== input.expectedContentHash)
    throw new RepositoryKnowledgeError(
      "knowledge_plan_stale",
      "The canonicalization candidate changed after review began.",
    );
  if (current.observedState === "stale" && input.action !== "reject")
    throw new RepositoryKnowledgeError(
      "knowledge_plan_stale",
      "The canonicalization candidate source bindings are stale and permit rejection only.",
    );
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{1,63}$/u.test(input.reviewerId))
    throw new RepositoryKnowledgeError(
      "knowledge_approval_required",
      "The canonicalization reviewer ID is invalid.",
    );
  const { observedState: _observedState, contentHash: _contentHash, ...currentRecord } = current;
  let next: CanonicalizationCandidateRecord;
  if (input.action === "promote") {
    if (
      input.targetPath === undefined ||
      input.targetContentHash === undefined ||
      canonicalResponsibilityForPath(input.targetPath) === null ||
      !current.sourceBindings.some(
        (binding) => binding.responsibility === canonicalResponsibilityForPath(input.targetPath!),
      )
    )
      throw new RepositoryKnowledgeError(
        "knowledge_approval_required",
        "Promotion requires one canonical target path and its exact current hash.",
      );
    const bytes = await readFile(resolve(root, input.targetPath));
    if (sha256(bytes) !== input.targetContentHash)
      throw new RepositoryKnowledgeError(
        "knowledge_plan_stale",
        "The canonical promotion target does not match the reviewed hash.",
      );
    next = {
      ...currentRecord,
      state: "promoted",
      review: null,
      promotion: {
        reviewerId: input.reviewerId,
        targetPath: input.targetPath,
        targetContentHash: input.targetContentHash,
        promotedAt: input.now.toISOString(),
      },
    };
  } else {
    next = {
      ...currentRecord,
      state: input.action === "defer" ? "pending" : "rejected",
      review: {
        reviewerId: input.reviewerId,
        decision: input.action,
        reviewedAt: input.now.toISOString(),
      },
      promotion: null,
    };
  }
  await writeCanonicalizationCandidateRecord(root, next);
  return readCanonicalizationCandidate(root, canonicalizationCandidatePath(input.candidateId));
}

/**
 * ADR-0561 undo of a background canonical review: returns a promoted, rejected, or held candidate
 * to `candidate`, so the background canonical reviewer judges it again. Only the private
 * candidate record changes; canonical documents are restored from Git.
 */
export async function reopenCanonicalizationCandidate(input: {
  repositoryRoot: string;
  candidateId: string;
}): Promise<CanonicalizationCandidateInspection> {
  const root = resolve(input.repositoryRoot);
  const current = (await listCanonicalizationCandidates(root)).find(
    (item) => item.candidateId === input.candidateId,
  );
  if (current === undefined)
    throw new RepositoryKnowledgeError(
      "knowledge_plan_stale",
      `Canonicalization candidate ${input.candidateId} does not exist.`,
    );
  if (current.state === "candidate")
    throw new RepositoryKnowledgeError(
      "knowledge_plan_stale",
      `Canonicalization candidate ${input.candidateId} is already open for review.`,
    );
  const { observedState: _observedState, contentHash: _contentHash, ...record } = current;
  await writeCanonicalizationCandidateRecord(root, {
    ...record,
    state: "candidate",
    review: null,
    promotion: null,
  });
  return readCanonicalizationCandidate(root, canonicalizationCandidatePath(input.candidateId));
}
