import {
  documentFreshnessUndoCommand,
  type DocumentFreshnessCandidateV1,
} from "@lervo/repository-knowledge";
import type { DocumentFreshnessStatusReport } from "@lervo/repository-knowledge-runtime";

function counts(record: Record<string, number>): string {
  const entries = Object.entries(record).sort(([left], [right]) => left.localeCompare(right));
  return entries.length === 0
    ? "none"
    : entries.map(([key, value]) => `${key} ${value}`).join(", ");
}

export function formatDocumentFreshnessStatus(status: DocumentFreshnessStatusReport): string {
  return [
    `Document freshness: ${status.enabled ? "enabled" : "disabled"} · stale ${status.summary.staleCount} · held by Lervo ${status.summary.awaitingReviewCount} · Lervo debt ${status.debt?.length ?? 0}${status.zeroSuccessHold ? ` · generation on hold until ${status.zeroSuccessHold.until}` : ""} (no owner action)`,
    `candidates by state: ${counts(status.counts.byState)}`,
    `candidates by priority: ${counts(status.counts.byPriority)}`,
    ...(status.technicalRecovery === undefined
      ? []
      : [
          `evidence recovery: pending ${status.technicalRecovery.pending} · exhausted ${status.technicalRecovery.exhausted} · ${counts(status.technicalRecovery.reasonCounts)}`,
        ]),
    `budget ${status.budget.day || "today"}: ${status.budget.tokensUsed} of ${status.budget.maximumTokensPerDay} tokens · attempts ${status.budget.attempts} · verified ${status.budget.verified}`,
    status.oldestOpen === null
      ? "oldest open candidate: none"
      : `oldest open candidate: ${status.oldestOpen.candidateId} ${status.oldestOpen.documentPath} · ${status.oldestOpen.ageSeconds}s`,
    `holds: ${status.holds.length === 0 ? "none" : status.holds.map((hold) => `${hold.documentPath} until ${hold.until} (${hold.reason})`).join("; ")}`,
    ...(status.debt ?? []).map(
      (debt) =>
        `Lervo debt ${debt.documentPath} · ${debt.reason} since ${debt.since} · attempts ${debt.attempts} · retry ${debt.retryAt}`,
    ),
    ...status.recentApplies.map(
      (apply) =>
        `applied ${apply.candidateId} ${apply.documentPath} · time to fresh ${apply.timeToFreshSeconds}s`,
    ),
    "",
  ].join("\n");
}

function classes(candidate: DocumentFreshnessCandidateV1): string {
  if (candidate.operation !== "edit") return candidate.operation;
  return [...new Set(candidate.hunks.map((hunk) => hunk.changeClass))].sort().join(",");
}

export function formatDocumentFreshnessReview(
  candidates: ReadonlyArray<DocumentFreshnessCandidateV1 & { retryAt: string | null }>,
): string {
  if (candidates.length === 0) return "Document freshness review: Lervo holds no candidate.\n";
  return `${[
    `Document freshness review: Lervo holds ${candidates.length} ${candidates.length === 1 ? "candidate" : "candidates"} (inspection only; no owner action)`,
    ...candidates.map(
      (candidate) =>
        `  ${candidate.state} ${candidate.candidateId} ${candidate.documentPath} · ${candidate.priorityClass} · ${classes(candidate)} · hunks pending ${candidate.pendingHunkIds.length}${candidate.crossCheckReview?.unavailableReason == null ? "" : ` · cross-check unavailable (${candidate.crossCheckReview.unavailableReason})`}${candidate.retryAt === null ? "" : ` · Lervo retries at ${candidate.retryAt}`}`,
    ),
  ].join("\n")}\n`;
}

function crossCheckSummary(candidate: DocumentFreshnessCandidateV1): string {
  const review = candidate.crossCheckReview;
  if (review === undefined) return candidate.crossCheck;
  if (review.status === "pending") return "pending";
  const rounds = candidate.crossCheckRounds?.length ?? 0;
  return [
    candidate.crossCheck,
    ...(rounds === 0 ? [] : [`earlier agreeing rounds ${rounds}`]),
    ...(review.unavailableReason === null ? [] : [`reason ${review.unavailableReason}`]),
    ...(review.reviewerProvider === null ? [] : [`reviewer ${review.reviewerProvider}`]),
    ...(review.runId === null ? [] : [`run ${review.runId}`]),
  ].join(" · ");
}

export function formatDocumentFreshnessCandidate(
  candidate: DocumentFreshnessCandidateV1,
  diff: string,
): string {
  return [
    `Freshness candidate ${candidate.candidateId} · ${candidate.state} · ${candidate.documentPath}`,
    `operation ${candidate.operation} · priority ${candidate.priorityClass} · cross-check ${crossCheckSummary(candidate)}`,
    ...candidate.checks.map((check) => `  check ${check.code}: ${check.status} (${check.detail})`),
    ...(candidate.explanation === null ? [] : [`explanation: ${candidate.explanation}`]),
    diff,
    candidate.state === "applied" || candidate.state === "partially_applied"
      ? `Undo: ${documentFreshnessUndoCommand(candidate.candidateId)}`
      : "Lervo applies this candidate itself once the cross-check agrees; nothing waits for the owner.",
    "",
  ].join("\n");
}
