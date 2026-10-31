import type {
  DocumentFreshnessAppliedAttentionItemV1,
  DocumentFreshnessBlockedAttentionItemV1,
  DocumentFreshnessCandidateAttentionItemV1,
  OperatingAttentionItemV1,
} from "@lervo/application-contract";
import {
  documentFreshnessApplyCommand,
  type DocumentFreshnessCandidateV1,
} from "@lervo/repository-knowledge";
import { documentFreshnessAttentionSources } from "@lervo/repository-knowledge-runtime";

/** Rebuildable freshness state the attention projection reads; absent means not observed. */
export interface DocumentFreshnessAttentionInput {
  awaiting: readonly DocumentFreshnessCandidateV1[];
  applied: readonly DocumentFreshnessCandidateV1[];
  blocked: { attempts: number } | null;
}

function changeClasses(
  candidate: DocumentFreshnessCandidateV1,
): DocumentFreshnessCandidateAttentionItemV1["changeClasses"] {
  if (candidate.operation === "archive") return ["archive"];
  return [...new Set(candidate.hunks.map((hunk) => hunk.changeClass))].sort();
}

function candidateItem(
  candidate: DocumentFreshnessCandidateV1,
): DocumentFreshnessCandidateAttentionItemV1 {
  return {
    schemaVersion: 1,
    kind: "document_freshness_candidate",
    itemId: `document_freshness_${candidate.candidateId}`,
    state: candidate.state as DocumentFreshnessCandidateAttentionItemV1["state"],
    candidateId: candidate.candidateId,
    documentPath: candidate.documentPath,
    priorityClass: candidate.priorityClass,
    changeClasses: changeClasses(candidate),
    hunkCount: candidate.pendingHunkIds.length,
    createdAt: candidate.createdAt,
    ownerConsequence: candidate.hunks.some(
      (hunk) =>
        candidate.pendingHunkIds.includes(hunk.hunkId) && hunk.changeClass === "safety_or_policy",
    )
      ? "security_policy"
      : candidate.archive?.ownership === "user_owned" ||
          candidate.hunks.some(
            (hunk) =>
              candidate.pendingHunkIds.includes(hunk.hunkId) &&
              (hunk.ownership === "user_owned" || hunk.authorityRequired === "owner"),
          )
        ? "repository_write"
        : null,
    actionOwner: "user",
    requiresUserAction: true,
    blocking: false,
    instruction:
      candidate.afterHash === null
        ? `Inspect with lervo knowledge freshness review ${candidate.candidateId}; the evidence did not determine a new value.`
        : `Inspect with lervo knowledge freshness review ${candidate.candidateId}; apply only with ${documentFreshnessApplyCommand(candidate)}.`,
  };
}

function appliedItem(
  candidate: DocumentFreshnessCandidateV1,
): DocumentFreshnessAppliedAttentionItemV1 {
  return {
    schemaVersion: 1,
    kind: "document_freshness_applied",
    itemId: `document_freshness_applied_${candidate.candidateId}`,
    state: candidate.state === "partially_applied" ? "partially_applied" : "applied",
    candidateId: candidate.candidateId,
    documentPath: candidate.documentPath,
    approvalSource: candidate.approval?.approvalSource ?? "lervo_managed",
    commitHash: candidate.commitHash,
    revertInstruction: `lervo knowledge freshness revert ${candidate.candidateId}`,
    actionOwner: "agent",
    requiresUserAction: false,
    blocking: false,
    instruction: `Lervo refreshed ${candidate.documentPath}; mention it in the turn report. Revert with lervo knowledge freshness revert ${candidate.candidateId}, or acknowledge with lervo knowledge freshness acknowledge ${candidate.candidateId}.`,
  };
}

function blockedItem(attempts: number): DocumentFreshnessBlockedAttentionItemV1 {
  return {
    schemaVersion: 1,
    kind: "document_freshness_blocked",
    itemId: "document_freshness_blocked_zero_success_window",
    state: "action_required",
    reasonCode: "zero_success_window",
    documentPath: null,
    attempts,
    actionOwner: "user",
    requiresUserAction: true,
    blocking: false,
    instruction:
      "Five freshness attempts today produced no verified candidate; inspect lervo knowledge freshness status and the provider before more spend.",
  };
}

/** Maps the rebuildable freshness state to the three ADR-0463 attention kinds. */
export function documentFreshnessAttentionItems(
  input: DocumentFreshnessAttentionInput,
): OperatingAttentionItemV1[] {
  return [
    ...input.awaiting.map(candidateItem),
    ...input.applied.map(appliedItem),
    ...(input.blocked === null ? [] : [blockedItem(input.blocked.attempts)]),
  ];
}

/** Reads the freshness state for a projection; an unreadable state contributes no items. */
export async function readDocumentFreshnessAttention(
  root: string,
  now: Date,
): Promise<DocumentFreshnessAttentionInput | null> {
  return documentFreshnessAttentionSources(root, now).catch(() => null);
}
