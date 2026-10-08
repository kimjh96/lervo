import {
  documentFreshnessCandidateNeedsEvidenceRecovery,
  documentFreshnessAutoApplicableHunks,
  documentFreshnessReviewStates,
  sha256,
  type DocumentFreshnessCandidateV1,
} from "@lervo/repository-knowledge";
import type { FreshnessGenerationContext } from "./freshness-generation.js";
import { recordFreshnessRejection } from "./freshness-events.js";
import { writeFreshnessCandidate } from "./freshness-state-store.js";
import { freshnessDependenciesCurrent } from "./freshness-dependencies.js";
import { applyLervoManagedFreshnessHunks, supersedeFreshnessCandidate } from "./freshness-apply.js";

/** Technical invalidation preserves old evidence and never creates approval or an owner hold. */
export async function recoverFreshnessCandidates(
  context: FreshnessGenerationContext,
  candidates: DocumentFreshnessCandidateV1[],
): Promise<DocumentFreshnessCandidateV1[]> {
  const result = [];
  for (const candidate of candidates) {
    if (documentFreshnessCandidateNeedsEvidenceRecovery(candidate)) {
      const next: DocumentFreshnessCandidateV1 = {
        ...candidate,
        state: "superseded",
        rejection: {
          reasonCode: "candidate_invalid",
          rejectorKind: "deterministic",
          contestedHunkIds: [],
        },
        updatedAt: context.now().toISOString(),
      };
      await writeFreshnessCandidate(context.storage.paths.repositoryRoot, next);
      recordFreshnessRejection({
        storage: context.storage,
        candidate: next,
        occurredAt: next.updatedAt,
      });
      result.push(next);
    } else if (
      candidate.dependencyWitness !== undefined &&
      [
        "generated",
        "verified",
        "waiting_authority",
        "verified_pending_cross_check",
        "partially_applied",
      ].includes(candidate.state) &&
      !(await freshnessDependenciesCurrent(
        context.storage.paths.repositoryRoot,
        candidate.dependencyWitness,
      ))
    ) {
      result.push(
        await supersedeFreshnessCandidate({
          storage: context.storage,
          candidate,
          now: context.now(),
        }),
      );
    } else result.push(candidate);
  }
  return result;
}

/**
 * Supersedes open candidates whose document bytes moved under them (F5): an owner edit during
 * review always wins, and the next observation produces a fresh candidate from the new bytes.
 */
export async function supersedeMovedCandidates(
  context: FreshnessGenerationContext,
  candidates: DocumentFreshnessCandidateV1[],
): Promise<DocumentFreshnessCandidateV1[]> {
  const root = context.storage.paths.repositoryRoot;
  const result: DocumentFreshnessCandidateV1[] = [];
  for (const candidate of candidates) {
    if (
      (!documentFreshnessReviewStates.has(candidate.state) && candidate.state !== "generated") ||
      candidate.operation === "archive"
    ) {
      result.push(candidate);
      continue;
    }
    const bytes = await workingBytes(root, candidate.documentPath);
    const expected = candidate.appliedHash ?? candidate.sourceHash;
    result.push(
      bytes !== null && sha256(bytes) === expected
        ? candidate
        : await supersedeFreshnessCandidate({
            storage: context.storage,
            candidate,
            now: context.now(),
          }),
    );
  }
  return result;
}

/** A crash between verification and apply leaves `verified` edits; Lervo finishes its own part. */
export async function resumeVerifiedCandidates(
  context: FreshnessGenerationContext,
  candidates: readonly DocumentFreshnessCandidateV1[],
): Promise<void> {
  for (const candidate of candidates) {
    if (candidate.state !== "verified" || candidate.operation !== "edit") continue;
    const automatic = documentFreshnessAutoApplicableHunks(candidate);
    if (automatic.length === 0) continue;
    try {
      await applyLervoManagedFreshnessHunks({
        storage: context.storage,
        candidate,
        hunkIds: new Set(automatic.map((hunk) => hunk.hunkId)),
        now: context.now(),
      });
    } catch (error) {
      if (!(error instanceof DocumentFreshnessOperationError)) throw error;
    }
  }
}

import { workingBytes } from "./freshness-cycle-observation.js";
import { DocumentFreshnessOperationError } from "./freshness-document-io.js";
