import type {
  DocumentFreshnessAppliedAttentionItemV1,
  DocumentFreshnessBlockedAttentionItemV1,
  DocumentFreshnessCandidateAttentionItemV1,
  OperatingAttentionItemV1,
} from "@lervo/application-contract";
import {
  documentFreshnessCrossCheckNotice,
  documentFreshnessCrossCheckRetryAt,
  documentFreshnessUndoCommand,
  documentFreshnessUserOwnedChange,
  type DocumentFreshnessCandidateV1,
  type DocumentFreshnessDebt,
} from "@lervo/repository-knowledge";
import { documentFreshnessAttentionSources } from "@lervo/repository-knowledge-runtime";

/**
 * Rebuildable freshness state the attention projection reads; absent means not observed. Since
 * ADR-0561 every item is Lervo's own work or an after-the-fact notice, never owner work.
 */
export interface DocumentFreshnessAttentionInput {
  held: readonly DocumentFreshnessCandidateV1[];
  applied: readonly DocumentFreshnessCandidateV1[];
  zeroSuccessHold: { since: string; until: string; attempts: number } | null;
  debt: readonly DocumentFreshnessDebt[];
  /** ADR-0604: absent in older inputs; a provider whose reviews report no usage. */
  usageUnavailable?: { provider: string; count: number; since: string; until: string } | null;
}

function changeClasses(
  candidate: DocumentFreshnessCandidateV1,
): DocumentFreshnessCandidateAttentionItemV1["changeClasses"] {
  if (candidate.operation === "archive") return ["archive"];
  return [...new Set(candidate.hunks.map((hunk) => hunk.changeClass))].sort();
}

function heldItem(
  candidate: DocumentFreshnessCandidateV1,
): DocumentFreshnessCandidateAttentionItemV1 {
  const retryAt = documentFreshnessCrossCheckRetryAt(candidate)?.toISOString() ?? null;
  const suggestion =
    candidate.state === "suggested" ||
    (candidate.state === "partially_applied" && documentFreshnessUserOwnedChange(candidate));
  const heldReason = suggestion
    ? "user_owned_content"
    : candidate.state === "waiting_authority"
      ? "legacy_owner_authority"
      : (candidate.crossCheckReview?.unavailableReason ?? "cross_check_pending");
  return {
    schemaVersion: 1,
    kind: "document_freshness_candidate",
    itemId: `document_freshness_${candidate.candidateId}`,
    state: "lervo_debt",
    candidateId: candidate.candidateId,
    documentPath: candidate.documentPath,
    priorityClass: candidate.priorityClass,
    changeClasses: changeClasses(candidate),
    hunkCount: candidate.pendingHunkIds.length,
    heldReason,
    retryAt,
    createdAt: candidate.createdAt,
    actionOwner: "host resident",
    requiresUserAction: false,
    blocking: false,
    instruction: suggestion
      ? `Suggestion: Lervo verified this change to user-owned bytes and never applies it (AGENTS.md invariant 5); apply it by hand if you want it, from lervo knowledge freshness review ${candidate.candidateId}. A later edit to the document replaces it.`
      : `Lervo debt: the knowledge resident holds this verified candidate (${heldReason}) and ${retryAt === null ? "finishes or regenerates it in its next cycle" : `retries the cross-check at ${retryAt}`}; inspect with lervo knowledge freshness review ${candidate.candidateId}.`,
  };
}

function appliedItem(
  candidate: DocumentFreshnessCandidateV1,
): DocumentFreshnessAppliedAttentionItemV1 {
  const undo = documentFreshnessUndoCommand(candidate.candidateId);
  return {
    schemaVersion: 1,
    kind: "document_freshness_applied",
    itemId: `document_freshness_applied_${candidate.candidateId}`,
    state: candidate.state === "partially_applied" ? "partially_applied" : "applied",
    candidateId: candidate.candidateId,
    documentPath: candidate.documentPath,
    approvalSource: candidate.approval?.approvalSource ?? "lervo_managed",
    commitHash: candidate.commitHash,
    revertInstruction: undo,
    actionOwner: "agent",
    requiresUserAction: false,
    blocking: false,
    // ADR-0561 notice: what changed, why, the cross-check behind it, and the undo.
    instruction: `Lervo ${candidate.operation === "archive" ? "archived" : "refreshed"} ${candidate.documentPath} (reason ${candidate.reasonsAddressed.join(", ") || "none"}; cross-check ${documentFreshnessCrossCheckNotice(candidate)}); mention it in the turn report. Undo with ${undo}, or acknowledge with lervo knowledge freshness acknowledge ${candidate.candidateId}.`,
  };
}

function zeroSuccessItem(hold: {
  since: string;
  until: string;
  attempts: number;
}): DocumentFreshnessBlockedAttentionItemV1 {
  return {
    schemaVersion: 1,
    kind: "document_freshness_blocked",
    itemId: "document_freshness_blocked_zero_success_window",
    state: "lervo_debt",
    reasonCode: "zero_success_window",
    documentPath: null,
    attempts: hold.attempts,
    since: hold.since,
    retryAt: hold.until,
    actionOwner: "host resident",
    requiresUserAction: false,
    blocking: false,
    instruction: `Lervo debt: ${hold.attempts} freshness attempts today produced no verified candidate, so new generation pauses until ${hold.until} and then retries with a doubled backoff; inspect lervo knowledge freshness status.`,
  };
}

function usageUnavailableItem(pause: {
  provider: string;
  count: number;
  since: string;
  until: string;
}): DocumentFreshnessBlockedAttentionItemV1 {
  return {
    schemaVersion: 1,
    kind: "document_freshness_blocked",
    itemId: `document_freshness_blocked_usage_unavailable_${pause.provider}`,
    state: "lervo_debt",
    reasonCode: "usage_unavailable",
    documentPath: null,
    attempts: pause.count,
    since: pause.since,
    retryAt: pause.until,
    actionOwner: "host resident",
    requiresUserAction: false,
    blocking: false,
    instruction: `Lervo debt: the ${pause.provider} provider reported no token usage for ${pause.count} no-change freshness reviews in a row, so their answers cannot be checked against the budget and Lervo stops paying for them until ${pause.until}. Update the provider CLI, or select a provider that reports usage.`,
  };
}

const debtWords: Record<DocumentFreshnessDebt["reason"], string> = {
  cross_check_disagreement_repeated:
    "the independent cross-check disagreed with the candidate and its regeneration",
  freshness_evidence_undetermined:
    "the evidence did not determine the new value after evidence recovery and regeneration",
  budget_exceeded: "the candidate exhausted its token budget",
};

function debtItem(debt: DocumentFreshnessDebt): DocumentFreshnessBlockedAttentionItemV1 {
  return {
    schemaVersion: 1,
    kind: "document_freshness_blocked",
    itemId: `document_freshness_blocked_${debt.reason}_${debt.candidateId}`,
    state: "lervo_debt",
    reasonCode: debt.reason,
    documentPath: debt.documentPath,
    attempts: debt.attempts,
    since: debt.since,
    retryAt: debt.retryAt,
    actionOwner: "host resident",
    requiresUserAction: false,
    blocking: false,
    instruction: `Lervo debt: ${debt.documentPath} stays stale because ${debtWords[debt.reason]}; Lervo retries at ${debt.retryAt}. Inspect lervo knowledge freshness review ${debt.candidateId}.`,
  };
}

/** Maps the rebuildable freshness state to the ADR-0463 attention kinds. */
export function documentFreshnessAttentionItems(
  input: DocumentFreshnessAttentionInput,
): OperatingAttentionItemV1[] {
  return [
    ...input.held.map(heldItem),
    ...input.applied.map(appliedItem),
    ...(input.zeroSuccessHold === null ? [] : [zeroSuccessItem(input.zeroSuccessHold)]),
    ...(input.usageUnavailable === null || input.usageUnavailable === undefined
      ? []
      : [usageUnavailableItem(input.usageUnavailable)]),
    ...input.debt.map(debtItem),
  ];
}

/** Reads the freshness state for a projection; an unreadable state contributes no items. */
export async function readDocumentFreshnessAttention(
  root: string,
  now: Date,
): Promise<DocumentFreshnessAttentionInput | null> {
  return documentFreshnessAttentionSources(root, now).catch(() => null);
}
