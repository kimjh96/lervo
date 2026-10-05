import { lstat, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import type { ProjectStorage } from "@lervo/project-storage";
import {
  documentFreshnessApplyCommand,
  documentFreshnessPolicy,
  documentFreshnessReviewStates,
  loadRepositoryKnowledgePolicy,
  sha256,
  type DocumentFreshnessCandidateV1,
  type DocumentFreshnessHold,
  type DocumentFreshnessSummary,
} from "@lervo/repository-knowledge";
import { withRepositoryKnowledgeWorkerLock } from "@lervo/repository-knowledge-compiler";

import { DocumentFreshnessOperationError } from "./freshness-document-io.js";
import { materializationTransactionState } from "./materialization-transaction.js";

const MATERIALIZATION_HELD = Symbol("materialization_held");
import { recordFreshnessRejection } from "./freshness-events.js";
import {
  listFreshnessCandidates,
  listFreshnessHolds,
  readFreshnessCandidate,
  readFreshnessCycleState,
  writeFreshnessCandidate,
  writeFreshnessHold,
} from "./freshness-state-store.js";

const MAXIMUM_LISTED = 64;
const APPLIED_NOTICE_MILLISECONDS = 24 * 3_600_000;

export interface DocumentFreshnessStatusReport {
  schemaVersion: 1;
  kind: "document_freshness.status";
  enabled: boolean;
  counts: { byState: Record<string, number>; byPriority: Record<string, number> };
  oldestOpen: { candidateId: string; documentPath: string; ageSeconds: number } | null;
  budget: {
    day: string;
    tokensUsed: number;
    maximumTokensPerDay: number;
    attempts: number;
    verified: number;
  };
  holds: Array<Pick<DocumentFreshnessHold, "documentPath" | "reason" | "until">>;
  recentApplies: Array<{ candidateId: string; documentPath: string; timeToFreshSeconds: number }>;
  summary: DocumentFreshnessSummary;
  lastCycleAt: string | null;
}

function tally(values: readonly string[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const value of values) counts[value] = (counts[value] ?? 0) + 1;
  return counts;
}

/** Read-only status for `lervo knowledge freshness status`; it never writes or calls a provider. */
export async function inspectDocumentFreshnessStatus(
  root: string,
  now: Date,
): Promise<DocumentFreshnessStatusReport> {
  const policy = documentFreshnessPolicy(await loadRepositoryKnowledgePolicy(root));
  const [candidates, holds, cycle] = await Promise.all([
    listFreshnessCandidates(root),
    listFreshnessHolds(root),
    readFreshnessCycleState(root),
  ]);
  const open = candidates
    .filter((candidate) => documentFreshnessReviewStates.has(candidate.state))
    .sort((left, right) => left.detectedAt.localeCompare(right.detectedAt));
  const applied = candidates
    .filter((candidate) => candidate.approval !== null && candidate.state !== "superseded")
    .sort((left, right) => right.approval!.approvedAt.localeCompare(left.approval!.approvedAt))
    .slice(0, 10);
  return {
    schemaVersion: 1,
    kind: "document_freshness.status",
    enabled: policy.enabled,
    counts: {
      byState: tally(candidates.map((candidate) => candidate.state)),
      byPriority: tally(candidates.map((candidate) => candidate.priorityClass)),
    },
    oldestOpen:
      open[0] === undefined
        ? null
        : {
            candidateId: open[0].candidateId,
            documentPath: open[0].documentPath,
            ageSeconds: Math.max(
              0,
              Math.round((now.getTime() - Date.parse(open[0].detectedAt)) / 1_000),
            ),
          },
    budget: {
      day: cycle.budget.day,
      tokensUsed: cycle.budget.tokensUsed,
      maximumTokensPerDay: policy.maximumTokensPerDay,
      attempts: cycle.budget.attempts,
      verified: cycle.budget.verified,
    },
    holds: holds
      .filter((hold) => Date.parse(hold.until) > now.getTime())
      .map((hold) => ({ documentPath: hold.documentPath, reason: hold.reason, until: hold.until })),
    recentApplies: applied.map((candidate) => ({
      candidateId: candidate.candidateId,
      documentPath: candidate.documentPath,
      timeToFreshSeconds: Math.max(
        0,
        Math.round(
          (Date.parse(candidate.approval!.approvedAt) - Date.parse(candidate.detectedAt)) / 1_000,
        ),
      ),
    })),
    summary: await documentFreshnessSummary(root, now),
    lastCycleAt: cycle.lastCycleAt,
  };
}

/** Candidates waiting for the owner, oldest first, each with its exact apply command. */
export async function listDocumentFreshnessReview(
  root: string,
): Promise<Array<DocumentFreshnessCandidateV1 & { applyCommand: string | null }>> {
  return (await listFreshnessCandidates(root))
    .filter((candidate) => documentFreshnessReviewStates.has(candidate.state))
    .sort((left, right) => left.detectedAt.localeCompare(right.detectedAt))
    .slice(0, MAXIMUM_LISTED)
    .map((candidate) => ({
      ...candidate,
      applyCommand: candidate.afterHash === null ? null : documentFreshnessApplyCommand(candidate),
    }));
}

async function sourceText(
  storage: Pick<ProjectStorage, "artifacts" | "paths">,
  candidate: DocumentFreshnessCandidateV1,
): Promise<Buffer | null> {
  if (candidate.beforeBytesRef !== null && candidate.operation === "edit")
    return Buffer.from(await storage.artifacts.get(candidate.beforeBytesRef));
  try {
    const path = resolve(storage.paths.repositoryRoot, candidate.documentPath);
    if (!(await lstat(path)).isFile()) return null;
    const bytes = await readFile(path);
    return sha256(bytes) === candidate.sourceHash ? bytes : null;
  } catch {
    return null;
  }
}

/** Unified diff of each hunk against the exact source bytes, for owner review. */
export async function renderDocumentFreshnessDiff(
  storage: Pick<ProjectStorage, "artifacts" | "paths">,
  candidate: DocumentFreshnessCandidateV1,
): Promise<string> {
  if (candidate.operation === "archive" && candidate.archive !== null)
    return [
      `--- a/${candidate.documentPath}`,
      `+++ b/${candidate.archive.targetPath}`,
      `+${candidate.archive.banner.trimEnd()}`,
      ...candidate.archive.inboundLinkRewrites.map(
        (rewrite) => `~ ${rewrite.path}:${rewrite.line} ${rewrite.from} -> ${rewrite.to}`,
      ),
    ].join("\n");
  const source = await sourceText(storage, candidate);
  if (source === null) return "(source bytes changed; the candidate will be superseded)";
  return candidate.hunks
    .map((hunk) => {
      const before = source.subarray(hunk.range.startByte, hunk.range.endByte).toString("utf8");
      return [
        `--- a/${candidate.documentPath}`,
        `+++ b/${candidate.documentPath}`,
        `@@ ${hunk.hunkId} bytes ${hunk.range.startByte}-${hunk.range.endByte} ${hunk.changeClass} ${hunk.ownership}${hunk.crossCheckRequired ? " cross-check-pending" : ""} @@`,
        ...before.split("\n").map((line) => `-${line}`),
        ...hunk.replacement.split("\n").map((line) => `+${line}`),
        ...hunk.claims.map(
          (claim) =>
            `# claim: ${claim.text} [${claim.evidence.map((item) => `${item.path}@${item.hash.slice(7, 19)}`).join(", ")}]`,
        ),
      ].join("\n");
    })
    .join("\n");
}

/** Owner surfaces' counts from the rebuildable state; cheap enough for the prompt path. */
export async function documentFreshnessSummary(
  root: string,
  now: Date,
): Promise<DocumentFreshnessSummary> {
  const [cycle, candidates] = await Promise.all([
    readFreshnessCycleState(root),
    listFreshnessCandidates(root),
  ]);
  return {
    ...cycle.summary,
    awaitingReviewCount: candidates.filter((candidate) =>
      documentFreshnessReviewStates.has(candidate.state),
    ).length,
    appliedRecentPaths: candidates
      .filter(
        (candidate) =>
          (candidate.state === "applied" || candidate.state === "partially_applied") &&
          candidate.acknowledgedAt === null &&
          candidate.approval !== null &&
          now.getTime() - Date.parse(candidate.approval.approvedAt) < APPLIED_NOTICE_MILLISECONDS,
      )
      .map((candidate) => candidate.documentPath)
      .slice(0, 8),
  };
}

/** Attention sources: waiting candidates and unacknowledged applies from the last 24 hours. */
export async function documentFreshnessAttentionSources(
  root: string,
  now: Date,
): Promise<{
  awaiting: DocumentFreshnessCandidateV1[];
  applied: DocumentFreshnessCandidateV1[];
  blocked: { attempts: number } | null;
}> {
  const [cycle, candidates] = await Promise.all([
    readFreshnessCycleState(root),
    listFreshnessCandidates(root),
  ]);
  return {
    awaiting: candidates
      .filter((candidate) => documentFreshnessReviewStates.has(candidate.state))
      .slice(0, 16),
    applied: candidates
      .filter(
        (candidate) =>
          (candidate.state === "applied" || candidate.state === "partially_applied") &&
          candidate.acknowledgedAt === null &&
          candidate.approval !== null &&
          now.getTime() - Date.parse(candidate.approval.approvedAt) < APPLIED_NOTICE_MILLISECONDS,
      )
      .slice(0, 16),
    blocked: cycle.summary.blocked ? { attempts: cycle.budget.attempts } : null,
  };
}

export async function requireFreshnessCandidate(
  root: string,
  candidateId: string,
): Promise<DocumentFreshnessCandidateV1> {
  const candidate = await readFreshnessCandidate(root, candidateId);
  if (candidate === null)
    throw new DocumentFreshnessOperationError(
      "candidate_not_found",
      `Freshness candidate ${candidateId} was not found.`,
    );
  return candidate;
}

/**
 * Owner rejection. `not_stale` counts as a false positive and holds the finding for the policy's
 * hold window; `incorrect` only closes the candidate so a new one may follow.
 */
export async function rejectFreshnessCandidate(input: {
  storage: Pick<ProjectStorage, "events" | "manifest" | "paths">;
  candidate: DocumentFreshnessCandidateV1;
  reason: "not_stale" | "incorrect";
  holdDays: number;
  now: Date;
}): Promise<DocumentFreshnessCandidateV1> {
  if (!documentFreshnessReviewStates.has(input.candidate.state))
    throw new DocumentFreshnessOperationError(
      "candidate_not_reviewable",
      `Candidate ${input.candidate.candidateId} is ${input.candidate.state}; only waiting candidates can be rejected.`,
    );
  const root = input.storage.paths.repositoryRoot;
  const next: DocumentFreshnessCandidateV1 = {
    ...input.candidate,
    state: "rejected",
    rejection: {
      reasonCode: "owner_rejected",
      rejectorKind: "owner",
      contestedHunkIds: input.candidate.pendingHunkIds,
    },
    updatedAt: input.now.toISOString(),
  };
  if (input.reason === "not_stale")
    await writeFreshnessHold(root, {
      schemaVersion: 1,
      findingDigest: next.findingDigest,
      documentPath: next.documentPath,
      candidateId: next.candidateId,
      reason: "not_stale",
      until: new Date(input.now.getTime() + input.holdDays * 86_400_000).toISOString(),
    });
  await writeFreshnessCandidate(root, next);
  recordFreshnessRejection({ storage: input.storage, candidate: next, occurredAt: next.updatedAt });
  return next;
}

/** Acknowledging an applied notice resolves its informational attention item. */
export async function acknowledgeFreshnessCandidate(
  root: string,
  candidate: DocumentFreshnessCandidateV1,
  now: Date,
): Promise<DocumentFreshnessCandidateV1> {
  const next = { ...candidate, acknowledgedAt: now.toISOString() };
  await writeFreshnessCandidate(root, next);
  return next;
}

/**
 * Owner operations share the knowledge worker's repository lock, so an apply or revert never
 * races the resident's freshness stage over the same candidate or document.
 */
export async function withDocumentFreshnessOwnerLock<T>(
  root: string,
  run: () => Promise<T>,
): Promise<T> {
  const result = await withRepositoryKnowledgeWorkerLock(root, async () =>
    // A materialization journal, live or interrupted, owns repository bytes (ADR-0444, ADR-0465).
    (await materializationTransactionState(root)) === "clear" ? run() : MATERIALIZATION_HELD,
  );
  if (result.status === "processed" && result.result === MATERIALIZATION_HELD)
    throw new DocumentFreshnessOperationError(
      "owner_lock_busy",
      "A knowledge materialization transaction owns the repository; retry after it finishes or recover it.",
    );
  if (result.status === "busy")
    throw new DocumentFreshnessOperationError(
      "owner_lock_busy",
      "The knowledge worker holds the repository lock; retry after its cycle finishes.",
    );
  return result.result as T;
}
