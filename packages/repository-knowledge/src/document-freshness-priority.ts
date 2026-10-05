import type {
  DocumentFreshnessCandidateV1,
  DocumentFreshnessFindingV1,
  DocumentFreshnessHold,
  DocumentFreshnessPolicy,
  DocumentFreshnessPriorityClass,
} from "./document-freshness-contract.js";

const classRank: Record<DocumentFreshnessPriorityClass, number> = {
  safety: 0,
  entrypoint: 1,
  canonical: 2,
  other: 3,
};

/** Candidate states that still own their finding; a new candidate would contend with them. */
const OPEN_STATES = new Set<DocumentFreshnessCandidateV1["state"]>([
  "generated",
  "verified_pending_cross_check",
  "waiting_authority",
  "partially_applied",
]);
/** States after which the same finding is settled until its evidence changes. */
const SETTLED_STATES = new Set<DocumentFreshnessCandidateV1["state"]>(["applied", "reverted"]);
const MAXIMUM_ATTEMPTS_PER_FINDING = 2;

function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/**
 * Case-insensitive whole-word match of a configured safety pattern. Inflections are not implied:
 * `live` must not match "lives in", so a repository lists plural forms it wants as patterns.
 */
export function documentFreshnessSafetyLine(line: string, patterns: readonly string[]): boolean {
  return patterns.some((pattern) => new RegExp(`\\b${pattern}\\b`, "iu").test(line));
}

/**
 * Lines a reason touches: lines whose references are unresolved or point at, or into, a changed
 * connected path. The whole document counts only for `superseded_by`.
 */
export function documentFreshnessTouchedLines(
  finding: DocumentFreshnessFindingV1,
  content: string,
): string[] {
  const lines = content.split(/\r?\n/u);
  if (finding.reasons.includes("superseded_by")) return lines;
  const changed = finding.connectedPathChanges.map((change) => change.path);
  const touched = new Set<number>();
  for (const reference of finding.references) {
    const affected =
      !reference.resolved ||
      changed.some((path) => reference.target === path || reference.target.startsWith(`${path}/`));
    if (affected) touched.add(reference.line);
  }
  return [...touched].sort((left, right) => left - right).map((line) => lines[line - 1] ?? "");
}

export function documentFreshnessPriorityClass(input: {
  finding: DocumentFreshnessFindingV1;
  content: string;
  policy: Pick<DocumentFreshnessPolicy, "safetyPatterns">;
}): DocumentFreshnessPriorityClass {
  if (
    documentFreshnessTouchedLines(input.finding, input.content).some((line) =>
      documentFreshnessSafetyLine(line, input.policy.safetyPatterns),
    )
  )
    return "safety";
  if (input.finding.publicationGroup === "entrypoint") return "entrypoint";
  if (input.finding.publicationGroup === "canonical") return "canonical";
  return "other";
}

export interface PrioritizedDocumentFreshnessFinding {
  finding: DocumentFreshnessFindingV1;
  priorityClass: DocumentFreshnessPriorityClass;
}

/** Class, then oldest detection, then more changed connected paths, then path. */
export function orderDocumentFreshnessFindings(
  findings: readonly PrioritizedDocumentFreshnessFinding[],
): PrioritizedDocumentFreshnessFinding[] {
  return [...findings].sort(
    (left, right) =>
      classRank[left.priorityClass] - classRank[right.priorityClass] ||
      compare(left.finding.detectedAt, right.finding.detectedAt) ||
      right.finding.connectedPathChanges.length - left.finding.connectedPathChanges.length ||
      compare(left.finding.documentPath, right.finding.documentPath),
  );
}

export interface DocumentFreshnessAdmission {
  admitted: PrioritizedDocumentFreshnessFinding[];
  /** Findings beyond the daily token budget or the per-cycle count. */
  skippedForBudget: number;
  /** The part of `skippedForBudget` only the per-cycle count deferred; the next cycle continues. */
  skippedForCycleLimit: number;
  skippedForHold: number;
  skippedOpen: number;
  skippedSettled: number;
}

export function activeDocumentFreshnessHold(
  holds: readonly DocumentFreshnessHold[],
  finding: Pick<DocumentFreshnessFindingV1, "findingDigest" | "documentPath">,
  now: Date,
): DocumentFreshnessHold | null {
  return (
    holds.find(
      (hold) =>
        (hold.findingDigest === finding.findingDigest ||
          hold.documentPath === finding.documentPath) &&
        Date.parse(hold.until) > now.getTime(),
    ) ?? null
  );
}

/**
 * Admits findings in priority order until the per-cycle count or the daily token budget would be
 * exceeded. Held findings, findings an open candidate still owns, settled findings, and findings
 * that already exhausted their attempts are never admitted; their evidence must change first.
 */
export function admitDocumentFreshnessFindings(input: {
  ordered: readonly PrioritizedDocumentFreshnessFinding[];
  candidates: readonly Pick<
    DocumentFreshnessCandidateV1,
    "findingDigest" | "documentPath" | "state" | "rejection"
  >[];
  holds: readonly DocumentFreshnessHold[];
  tokensUsedToday: number;
  policy: Pick<
    DocumentFreshnessPolicy,
    "maximumCandidatesPerCycle" | "maximumTokensPerCandidate" | "maximumTokensPerDay"
  >;
  now: Date;
}): DocumentFreshnessAdmission {
  const result: DocumentFreshnessAdmission = {
    admitted: [],
    skippedForBudget: 0,
    skippedForCycleLimit: 0,
    skippedForHold: 0,
    skippedOpen: 0,
    skippedSettled: 0,
  };
  for (const entry of input.ordered) {
    const { finding } = entry;
    if (activeDocumentFreshnessHold(input.holds, finding, input.now) !== null) {
      result.skippedForHold += 1;
      continue;
    }
    if (
      input.candidates.some(
        (candidate) =>
          OPEN_STATES.has(candidate.state) && candidate.documentPath === finding.documentPath,
      )
    ) {
      result.skippedOpen += 1;
      continue;
    }
    const prior = input.candidates.filter(
      (candidate) => candidate.findingDigest === finding.findingDigest,
    );
    if (
      prior.some((candidate) => SETTLED_STATES.has(candidate.state)) ||
      prior.filter((candidate) => candidate.state === "rejected").length >=
        MAXIMUM_ATTEMPTS_PER_FINDING ||
      prior.some(
        (candidate) =>
          candidate.state === "verified" || candidate.rejection?.reasonCode === "owner_rejected",
      )
    ) {
      result.skippedSettled += 1;
      continue;
    }
    const projected =
      input.tokensUsedToday + (result.admitted.length + 1) * input.policy.maximumTokensPerCandidate;
    if (projected > input.policy.maximumTokensPerDay) {
      result.skippedForBudget += 1;
      continue;
    }
    if (result.admitted.length >= input.policy.maximumCandidatesPerCycle) {
      result.skippedForBudget += 1;
      result.skippedForCycleLimit += 1;
      continue;
    }
    result.admitted.push(entry);
  }
  return result;
}
