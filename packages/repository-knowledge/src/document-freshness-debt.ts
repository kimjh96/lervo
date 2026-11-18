import type {
  DocumentFreshnessCandidateV1,
  DocumentFreshnessDebt,
  DocumentFreshnessDebtReason,
} from "./document-freshness-contract.js";

/**
 * ADR-0561 Lervo debt for document freshness: findings Lervo could not resolve itself, held with
 * backoff and shown in health with their age and reason, never as owner work. Pure; the runtime
 * stores the projection in its rebuildable cycle state.
 */

const DAY = 86_400_000;
const HOUR = 3_600_000;
const MAXIMUM_DEBT_BACKOFF = 16 * DAY;
const MAXIMUM_CROSS_CHECK_RETRY_BACKOFF = DAY;
/** The original candidate and its single regeneration (ADR-0463). */
const FAILED_ATTEMPTS_BEFORE_DEBT = 2;
const MAXIMUM_DEBT_ENTRIES = 512;

type DebtCandidate = Pick<
  DocumentFreshnessCandidateV1,
  | "candidateId"
  | "findingDigest"
  | "documentPath"
  | "operation"
  | "state"
  | "rejection"
  | "createdAt"
>;

/** One day doubled for each consecutive failed attempt, at most sixteen days. */
function documentFreshnessDebtBackoffMilliseconds(attempts: number): number {
  return Math.min(MAXIMUM_DEBT_BACKOFF, DAY * 2 ** Math.max(0, attempts - 1));
}

function undetermined(candidate: DebtCandidate): boolean {
  return (
    candidate.operation === "needs_owner_input" &&
    candidate.rejection?.reasonCode === "candidate_invalid"
  );
}

/** Attempts that end in Lervo debt once the regeneration fails too. */
function failedAttempt(candidate: DebtCandidate): boolean {
  return (
    candidate.state === "rejected" &&
    (candidate.rejection?.reasonCode === "cross_check_disagreement" || undetermined(candidate))
  );
}

function debtReason(
  latest: DebtCandidate,
  failedAttempts: number,
): DocumentFreshnessDebtReason | null {
  if (latest.state !== "rejected") return null;
  if (latest.rejection?.reasonCode === "freshness_budget_exhausted") return "budget_exceeded";
  if (failedAttempts < FAILED_ATTEMPTS_BEFORE_DEBT) return null;
  if (latest.rejection?.reasonCode === "cross_check_disagreement")
    return "cross_check_disagreement_repeated";
  return undetermined(latest) ? "freshness_evidence_undetermined" : null;
}

const RESOLVED_STATES = new Set<DocumentFreshnessCandidateV1["state"]>([
  "applied",
  "verified",
  "reverted",
  "superseded",
]);

/**
 * Projects the debt from the candidate store and the previous projection. A finding enters debt
 * when its candidate and single regeneration both met cross-check disagreement or both left the
 * value undetermined, or at once when a candidate exhausted its token budget. Each later failed
 * retry doubles the backoff; an applied, verified, reverted, or superseded latest candidate clears
 * the debt, and an open retry keeps it unchanged.
 */
export function projectDocumentFreshnessDebt(input: {
  candidates: readonly DebtCandidate[];
  previous: readonly DocumentFreshnessDebt[];
  now: Date;
}): DocumentFreshnessDebt[] {
  const byFinding = new Map<string, DebtCandidate[]>();
  for (const candidate of input.candidates)
    byFinding.set(candidate.findingDigest, [
      ...(byFinding.get(candidate.findingDigest) ?? []),
      candidate,
    ]);
  const previous = new Map(input.previous.map((debt) => [debt.findingDigest, debt]));
  const debts: DocumentFreshnessDebt[] = [];
  for (const [findingDigest, group] of byFinding) {
    const ordered = [...group].sort((left, right) =>
      left.createdAt === right.createdAt
        ? left.candidateId.localeCompare(right.candidateId)
        : left.createdAt.localeCompare(right.createdAt),
    );
    const latest = ordered.at(-1)!;
    const prior = previous.get(findingDigest);
    if (RESOLVED_STATES.has(latest.state)) continue;
    if (latest.state !== "rejected") {
      if (prior !== undefined) debts.push(prior);
      continue;
    }
    if (prior?.candidateId === latest.candidateId) {
      debts.push(prior);
      continue;
    }
    // A retry rejected for another reason keeps the debt it retried.
    const reason =
      debtReason(latest, ordered.filter(failedAttempt).length) ?? prior?.reason ?? null;
    if (reason === null) continue;
    const attempts = (prior?.attempts ?? 0) + 1;
    debts.push({
      findingDigest,
      documentPath: latest.documentPath,
      candidateId: latest.candidateId,
      reason,
      since: prior?.since ?? input.now.toISOString(),
      attempts,
      retryAt: new Date(
        input.now.getTime() + documentFreshnessDebtBackoffMilliseconds(attempts),
      ).toISOString(),
    });
  }
  return debts
    .sort((left, right) =>
      left.since === right.since
        ? left.documentPath.localeCompare(right.documentPath)
        : left.since.localeCompare(right.since),
    )
    .slice(0, MAXIMUM_DEBT_ENTRIES);
}

/**
 * When Lervo retries a cross-check that settled as unavailable: one hour after the settlement,
 * doubled for each earlier retry, at most one day. Null when the candidate has no such call.
 */
export function documentFreshnessCrossCheckRetryAt(
  candidate: Pick<DocumentFreshnessCandidateV1, "state" | "crossCheck" | "crossCheckReview">,
): Date | null {
  const review = candidate.crossCheckReview;
  if (
    (candidate.state !== "verified_pending_cross_check" &&
      candidate.state !== "partially_applied") ||
    candidate.crossCheck !== "unavailable" ||
    review?.status !== "settled" ||
    review.settledAt === null
  )
    return null;
  const backoff = Math.min(MAXIMUM_CROSS_CHECK_RETRY_BACKOFF, HOUR * 2 ** (review.retries ?? 0));
  return new Date(Date.parse(review.settledAt) + backoff);
}
