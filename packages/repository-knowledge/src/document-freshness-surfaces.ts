import type {
  DocumentFreshnessCandidateV1,
  DocumentFreshnessPriorityClass,
} from "./document-freshness-contract.js";

/** Counts every owner-facing surface renders; computed by the runtime from its rebuildable state. */
export interface DocumentFreshnessSummary {
  staleCount: number;
  safetyCount: number;
  firstSafetyPath: string | null;
  awaitingReviewCount: number;
  appliedRecentPaths: string[];
  blocked: boolean;
}

const MAXIMUM_COMPACT_LINE_BYTES = 200;
const MAXIMUM_SEGMENT_BYTES = 160;

/** States in which a candidate waits for the owner before more bytes change. */
export const documentFreshnessReviewStates = new Set<DocumentFreshnessCandidateV1["state"]>([
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
    parts.push(
      `${plural(summary.awaitingReviewCount, "candidate")} ${summary.awaitingReviewCount === 1 ? "awaits" : "await"} review`,
    );
  if (summary.appliedRecentPaths.length > 0)
    parts.push(`${summary.appliedRecentPaths.length} refreshed`);
  if (summary.blocked) parts.push("blocked");
  return bounded(
    `Document freshness: ${parts.join(", ")}; lervo knowledge freshness review`,
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
  if (summary.awaitingReviewCount > 0) parts.push(`${summary.awaitingReviewCount} awaiting owner`);
  return parts.length === 0 ? null : bounded(`docs: ${parts.join(", ")}`, MAXIMUM_SEGMENT_BYTES);
}

const priorityWords: Record<DocumentFreshnessPriorityClass, string> = {
  safety: "safety",
  entrypoint: "entrypoint",
  canonical: "canonical",
  other: "document",
};

function changeClasses(
  candidate: Pick<DocumentFreshnessCandidateV1, "hunks" | "operation">,
): string {
  if (candidate.operation === "archive") return "archive";
  return [...new Set(candidate.hunks.map((hunk) => hunk.changeClass))].sort().join(", ");
}

/** The one-line owner question for an escalation batch; carries identifiers, never hunk text. */
export function documentFreshnessEscalationQuestion(
  candidate: Pick<
    DocumentFreshnessCandidateV1,
    "candidateId" | "documentPath" | "hunks" | "operation" | "priorityClass"
  >,
): string {
  return `Apply ${priorityWords[candidate.priorityClass]} freshness candidate \`${candidate.candidateId}\` to \`${candidate.documentPath}\` (\`${changeClasses(candidate)}\`)?`;
}

/** The exact owner apply command; the approval binds the verified output hash. */
export function documentFreshnessApplyCommand(
  candidate: Pick<DocumentFreshnessCandidateV1, "candidateId" | "afterHash">,
): string {
  return `lervo knowledge freshness apply ${candidate.candidateId} --approval ${candidate.afterHash}`;
}

const affirmative =
  /^(?:yes|y|ok|okay|approve|approved|apply|apply it|go ahead|lgtm|ship it|네|예|응|적용|적용해|승인)[.!]?$/iu;
const explicitApply = /\b(?:apply|approve)\b[^\n]*?\b(kfresh_[a-f0-9]{24})\b/iu;

/**
 * Translates an owner's natural-language reply in an escalation thread into the exact apply
 * command. An explicit candidate identifier always wins; a bare affirmative binds only when
 * exactly one candidate waits, so an ambiguous reply never approves anything.
 */
export function documentFreshnessApprovalFromReply(input: {
  reply: string;
  awaiting: readonly Pick<DocumentFreshnessCandidateV1, "candidateId" | "afterHash" | "state">[];
}): { candidateId: string; afterHash: string; command: string } | null {
  const reply = input.reply.trim();
  const waiting = input.awaiting.filter(
    (candidate) =>
      documentFreshnessReviewStates.has(candidate.state) && candidate.afterHash !== null,
  );
  const named = explicitApply.exec(reply)?.[1];
  const target =
    named !== undefined
      ? waiting.find((candidate) => candidate.candidateId === named)
      : affirmative.test(reply) && waiting.length === 1
        ? waiting[0]
        : undefined;
  if (target === undefined || target.afterHash === null) return null;
  return {
    candidateId: target.candidateId,
    afterHash: target.afterHash,
    command: documentFreshnessApplyCommand(target),
  };
}
