import type { DocumentFreshnessCandidateV1 } from "@lervo/repository-knowledge";
import type { DocumentFreshnessStatusReport } from "@lervo/repository-knowledge-runtime";

function counts(record: Record<string, number>): string {
  const entries = Object.entries(record).sort(([left], [right]) => left.localeCompare(right));
  return entries.length === 0
    ? "none"
    : entries.map(([key, value]) => `${key} ${value}`).join(", ");
}

export function formatDocumentFreshnessStatus(status: DocumentFreshnessStatusReport): string {
  return [
    `Document freshness: ${status.enabled ? "enabled" : "disabled"} · stale ${status.summary.staleCount} · awaiting review ${status.summary.awaitingReviewCount}${status.summary.blocked ? " · blocked" : ""}`,
    `candidates by state: ${counts(status.counts.byState)}`,
    `candidates by priority: ${counts(status.counts.byPriority)}`,
    `budget ${status.budget.day || "today"}: ${status.budget.tokensUsed} of ${status.budget.maximumTokensPerDay} tokens · attempts ${status.budget.attempts} · verified ${status.budget.verified}`,
    status.oldestOpen === null
      ? "oldest open candidate: none"
      : `oldest open candidate: ${status.oldestOpen.candidateId} ${status.oldestOpen.documentPath} · ${status.oldestOpen.ageSeconds}s`,
    `holds: ${status.holds.length === 0 ? "none" : status.holds.map((hold) => `${hold.documentPath} until ${hold.until} (${hold.reason})`).join("; ")}`,
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
  candidates: ReadonlyArray<DocumentFreshnessCandidateV1 & { applyCommand: string | null }>,
): string {
  if (candidates.length === 0) return "Document freshness review: no candidate awaits the owner.\n";
  return `${[
    `Document freshness review: ${candidates.length} ${candidates.length === 1 ? "candidate awaits" : "candidates await"} the owner`,
    ...candidates.map(
      (candidate) =>
        `  ${candidate.state} ${candidate.candidateId} ${candidate.documentPath} · ${candidate.priorityClass} · ${classes(candidate)} · hunks pending ${candidate.pendingHunkIds.length}${candidate.crossCheck === "unavailable" ? " · cross-check unavailable, owner review instead" : ""}\n    ${candidate.applyCommand ?? "no apply command: the candidate needs owner input"}`,
    ),
  ].join("\n")}\n`;
}

export function formatDocumentFreshnessCandidate(
  candidate: DocumentFreshnessCandidateV1,
  diff: string,
): string {
  return [
    `Freshness candidate ${candidate.candidateId} · ${candidate.state} · ${candidate.documentPath}`,
    `operation ${candidate.operation} · priority ${candidate.priorityClass} · authority ${candidate.authorityRequired} · cross-check ${candidate.crossCheck}`,
    ...candidate.checks.map((check) => `  check ${check.code}: ${check.status} (${check.detail})`),
    ...(candidate.explanation === null ? [] : [`explanation: ${candidate.explanation}`]),
    diff,
    candidate.afterHash === null
      ? "No apply command: the candidate has no verified output."
      : `Apply: lervo knowledge freshness apply ${candidate.candidateId} --approval ${candidate.afterHash}`,
    "",
  ].join("\n");
}
