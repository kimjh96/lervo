import type {
  DocumentFreshnessCandidateV1,
  DocumentFreshnessDebt,
} from "./document-freshness-contract.js";

/** Counts every owner-facing surface renders; computed by the runtime from its rebuildable state. */
export interface DocumentFreshnessSummary {
  staleCount: number;
  safetyCount: number;
  firstSafetyPath: string | null;
  /**
   * Candidates Lervo still holds, such as a cross-check waiting for its retry. The field name
   * predates ADR-0561; none of them waits for the owner.
   */
  awaitingReviewCount: number;
  appliedRecentPaths: string[];
  /** True while the zero-success hold pauses new generation (ADR-0561). */
  blocked: boolean;
  /** Additive (ADR-0561): the oldest Lervo debt entries, at most eight. */
  debt?: Array<Pick<DocumentFreshnessDebt, "documentPath" | "reason" | "since">>;
}

const MAXIMUM_COMPACT_LINE_BYTES = 200;
const MAXIMUM_SEGMENT_BYTES = 160;

/**
 * States in which Lervo still holds a verified candidate before more bytes change: a cross-check
 * waiting for its retry, or the rest of a partial apply. `waiting_authority` exists only on records
 * written before ADR-0561, which recovery supersedes. None waits for the owner.
 */
export const documentFreshnessHeldStates = new Set<DocumentFreshnessCandidateV1["state"]>([
  "waiting_authority",
  "verified_pending_cross_check",
  "partially_applied",
]);

function bounded(value: string, maximumBytes: number): string {
  if (Buffer.byteLength(value, "utf8") <= maximumBytes) return value;
  let text = value;
  while (Buffer.byteLength(`${text}...`, "utf8") > maximumBytes) text = text.slice(0, -1);
  return `${text}...`;
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

/** One compact-context line of at most 200 bytes, or null when every count is zero. */
export function documentFreshnessCompactLine(summary: DocumentFreshnessSummary): string | null {
  if (
    summary.staleCount === 0 &&
    summary.awaitingReviewCount === 0 &&
    summary.appliedRecentPaths.length === 0 &&
    (summary.debt?.length ?? 0) === 0 &&
    !summary.blocked
  )
    return null;
  const parts = [
    `${summary.staleCount} stale${
      summary.safetyCount > 0 && summary.firstSafetyPath !== null
        ? ` (${summary.safetyCount} safety: ${summary.firstSafetyPath})`
        : ""
    }`,
  ];
  if (summary.awaitingReviewCount > 0)
    parts.push(`${plural(summary.awaitingReviewCount, "candidate")} held by Lervo`);
  if ((summary.debt?.length ?? 0) > 0) parts.push(`${summary.debt!.length} Lervo debt`);
  if (summary.appliedRecentPaths.length > 0)
    parts.push(`${summary.appliedRecentPaths.length} refreshed`);
  if (summary.blocked) parts.push("generation on hold");
  return bounded(
    `Document freshness (no owner action): ${parts.join(", ")}; lervo knowledge freshness status`,
    MAXIMUM_COMPACT_LINE_BYTES,
  );
}

/** The ADR-0459 turn-report documents segment, or null when nothing changed or waits. */
export function documentFreshnessTurnReportSegment(
  summary: DocumentFreshnessSummary,
): string | null {
  const parts: string[] = [];
  if (summary.appliedRecentPaths.length > 0)
    parts.push(
      `${summary.appliedRecentPaths.length} refreshed (${summary.appliedRecentPaths.slice(0, 2).join(", ")})`,
    );
  if (summary.awaitingReviewCount > 0) parts.push(`${summary.awaitingReviewCount} held by Lervo`);
  return parts.length === 0 ? null : bounded(`docs: ${parts.join(", ")}`, MAXIMUM_SEGMENT_BYTES);
}

/**
 * ADR-0561 notice text for the cross-check behind an apply: the verdict, how many independent
 * agreeing checks there were, and which reviewer ran each. It names providers and run IDs only.
 */
export function documentFreshnessCrossCheckNotice(
  candidate: Pick<
    DocumentFreshnessCandidateV1,
    "crossCheck" | "crossCheckReview" | "crossCheckRounds"
  >,
): string {
  if (candidate.crossCheck !== "agreement") return candidate.crossCheck;
  const rounds = [
    ...(candidate.crossCheckRounds ?? []),
    ...(candidate.crossCheckReview ? [candidate.crossCheckReview] : []),
  ];
  const reviewers = rounds.map(
    (round) => `${round.reviewerProvider ?? "unknown"} ${round.runId ?? "no-run"}`,
  );
  return `agreement ${rounds.length}/${rounds.length} (${reviewers.join("; ")})`;
}

/** The undo command every applied freshness change reports (ADR-0561). */
export function documentFreshnessUndoCommand(candidateId: string): string {
  return `lervo knowledge freshness revert ${candidateId}`;
}
