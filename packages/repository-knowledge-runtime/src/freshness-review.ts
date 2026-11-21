import { lstat, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import type { ProjectStorage } from "@lervo/project-storage";
import {
  documentFreshnessCrossCheckRetryAt,
  documentFreshnessHeldStates,
  documentFreshnessPolicy,
  loadRepositoryKnowledgePolicy,
  sha256,
  type DocumentFreshnessCandidateV1,
  type DocumentFreshnessDebt,
  type DocumentFreshnessHold,
  type DocumentFreshnessSummary,
} from "@lervo/repository-knowledge";
import { withRepositoryKnowledgeWorkerLock } from "@lervo/repository-knowledge-compiler";

import { DocumentFreshnessOperationError } from "./freshness-document-io.js";
import { materializationTransactionState } from "./materialization-transaction.js";

const MATERIALIZATION_HELD = Symbol("materialization_held");
import {
  listFreshnessCandidates,
  listFreshnessHolds,
  readFreshnessCandidate,
  readFreshnessCycleState,
  writeFreshnessCandidate,
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
  technicalRecovery?: { pending: number; exhausted: number; reasonCounts: Record<string, number> };
  /** Additive (ADR-0561): findings Lervo holds as its own debt, oldest first. */
  debt?: Array<
    Pick<DocumentFreshnessDebt, "documentPath" | "reason" | "since" | "attempts" | "retryAt">
  >;
  /** Additive (ADR-0561): the active zero-success generation hold, or null. */
  zeroSuccessHold?: { since: string; until: string } | null;
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
    .filter((candidate) => documentFreshnessHeldStates.has(candidate.state))
    .sort((left, right) => left.detectedAt.localeCompare(right.detectedAt));
  const applied = candidates
    .filter((candidate) => candidate.approval !== null && candidate.state !== "superseded")
    .sort((left, right) => right.approval!.approvedAt.localeCompare(left.approval!.approvedAt))
    .slice(0, 10);
  return {
    schemaVersion: 1,
    kind: "document_freshness.status",
    enabled: policy.enabled,
    technicalRecovery: {
      pending: Object.values(cycle.evidenceRecovery ?? {}).filter(
        (item) => item.attempts < 2 || item.nextCursor !== null,
      ).length,
      exhausted: Object.values(cycle.evidenceRecovery ?? {}).filter(
        (item) => item.attempts >= 2 && item.nextCursor === null,
      ).length,
      reasonCounts: tally(Object.values(cycle.evidenceRecovery ?? {}).map((item) => item.reason)),
    },
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
    debt: (cycle.debt ?? []).slice(0, MAXIMUM_LISTED).map((entry) => ({
      documentPath: entry.documentPath,
      reason: entry.reason,
      since: entry.since,
      attempts: entry.attempts,
      retryAt: entry.retryAt,
    })),
    zeroSuccessHold: activeZeroSuccessHold(cycle, now),
  };
}

function activeZeroSuccessHold(
  cycle: Awaited<ReturnType<typeof readFreshnessCycleState>>,
  now: Date,
): { since: string; until: string } | null {
  const hold = cycle.zeroSuccessHold;
  return hold === undefined || hold === null || Date.parse(hold.until) <= now.getTime()
    ? null
    : { since: hold.since, until: hold.until };
}

/**
 * Candidates Lervo still holds, oldest first, each with when its cross-check is retried. They are
 * for inspection only: Lervo finishes or regenerates them itself (ADR-0561).
 */
export async function listDocumentFreshnessReview(
  root: string,
): Promise<Array<DocumentFreshnessCandidateV1 & { retryAt: string | null }>> {
  return (await listFreshnessCandidates(root))
    .filter((candidate) => documentFreshnessHeldStates.has(candidate.state))
    .sort((left, right) => left.detectedAt.localeCompare(right.detectedAt))
    .slice(0, MAXIMUM_LISTED)
    .map((candidate) => ({
      ...candidate,
      retryAt: documentFreshnessCrossCheckRetryAt(candidate)?.toISOString() ?? null,
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

/** Unified diff of each hunk against the exact source bytes, for inspection. */
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
  const verdicts = new Map(
    (candidate.crossCheckReview?.verdicts ?? []).map((verdict) => [verdict.hunkId, verdict]),
  );
  return candidate.hunks
    .map((hunk) => {
      const before = source.subarray(hunk.range.startByte, hunk.range.endByte).toString("utf8");
      const verdict = verdicts.get(hunk.hunkId);
      return [
        `--- a/${candidate.documentPath}`,
        `+++ b/${candidate.documentPath}`,
        `@@ ${hunk.hunkId} bytes ${hunk.range.startByte}-${hunk.range.endByte} ${hunk.changeClass} ${hunk.ownership}${hunkCrossCheckLabel(candidate, hunk.crossCheckRequired, verdict?.verdict)} @@`,
        ...before.split("\n").map((line) => `-${line}`),
        ...hunk.replacement.split("\n").map((line) => `+${line}`),
        ...hunk.claims.map(
          (claim) =>
            `# claim: ${claim.text} [${claim.evidence.map((item) => `${item.path}@${item.hash.slice(7, 19)}`).join(", ")}]`,
        ),
        ...(verdict === undefined ? [] : [`# cross-check ${verdict.verdict}: ${verdict.reason}`]),
      ].join("\n");
    })
    .join("\n");
}

/** Per-hunk Tier 0 label: the reviewer's verdict, or why the hunk has none. */
function hunkCrossCheckLabel(
  candidate: DocumentFreshnessCandidateV1,
  required: boolean,
  verdict: "agree" | "disagree" | undefined,
): string {
  if (verdict !== undefined) return ` cross-check-${verdict}`;
  if (!required) return "";
  if (candidate.crossCheckReview?.status === "pending") return " cross-check-pending";
  return " cross-check-unavailable";
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
      documentFreshnessHeldStates.has(candidate.state),
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

/**
 * Attention sources: held candidates, unacknowledged applies from the last 24 hours, the active
 * zero-success hold, and Lervo debt. None of them is owner work (ADR-0561).
 */
export async function documentFreshnessAttentionSources(
  root: string,
  now: Date,
): Promise<{
  held: DocumentFreshnessCandidateV1[];
  applied: DocumentFreshnessCandidateV1[];
  zeroSuccessHold: { since: string; until: string; attempts: number } | null;
  debt: DocumentFreshnessDebt[];
  /** ADR-0604: a provider whose no-change reviews are paused for reporting no usage. */
  usageUnavailable: { provider: string; count: number; since: string; until: string } | null;
}> {
  const [cycle, candidates] = await Promise.all([
    readFreshnessCycleState(root),
    listFreshnessCandidates(root),
  ]);
  const hold = activeZeroSuccessHold(cycle, now);
  return {
    // Totals must precede the attention report's return cap.
    held: candidates.filter((candidate) => documentFreshnessHeldStates.has(candidate.state)),
    applied: candidates.filter(
      (candidate) =>
        (candidate.state === "applied" || candidate.state === "partially_applied") &&
        candidate.acknowledgedAt === null &&
        candidate.approval !== null &&
        now.getTime() - Date.parse(candidate.approval.approvedAt) < APPLIED_NOTICE_MILLISECONDS,
    ),
    zeroSuccessHold: hold === null ? null : { ...hold, attempts: cycle.budget.attempts },
    debt: cycle.debt ?? [],
    // ADR-0604: attention only while the pause lasts; it ends by itself when the pause does.
    usageUnavailable:
      cycle.usageUnavailable?.until === null ||
      cycle.usageUnavailable === undefined ||
      cycle.usageUnavailable === null ||
      Date.parse(cycle.usageUnavailable.until) <= now.getTime()
        ? null
        : { ...cycle.usageUnavailable, until: cycle.usageUnavailable.until },
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
 * Owner operations (revert and acknowledge) share the knowledge worker's repository lock, so they
 * never race the resident's freshness stage over the same candidate or document.
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
