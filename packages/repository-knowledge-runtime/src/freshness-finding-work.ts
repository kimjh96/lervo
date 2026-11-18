import {
  canonicalJson,
  sha256,
  DOCUMENT_FRESHNESS_EVIDENCE_CONTRACT,
  type DocumentFreshnessCandidateV1,
  type DocumentFreshnessPolicy,
  type DocumentFreshnessOwnership,
  type PrioritizedDocumentFreshnessFinding,
} from "@lervo/repository-knowledge";
import type { FreshnessGenerationContext } from "./freshness-generation.js";
import { generateFreshnessCandidate } from "./freshness-candidate-generation.js";
import { DocumentFreshnessOperationError } from "./freshness-document-io.js";
import { appendFreshnessMaintenanceEvent } from "./freshness-maintenance-events.js";
import type { FreshnessCycleState } from "./freshness-state-store.js";
export function freshnessRecoveryKey(
  entry: PrioritizedDocumentFreshnessFinding,
  policy: DocumentFreshnessPolicy,
): string {
  return sha256(
    canonicalJson([
      entry.finding.documentPath,
      entry.finding.documentHash,
      entry.finding.connectedPathChanges,
      entry.finding.references,
      policy,
      DOCUMENT_FRESHNESS_EVIDENCE_CONTRACT,
    ]),
  );
}
export async function processFreshnessFindings(input: {
  context: FreshnessGenerationContext;
  admitted: PrioritizedDocumentFreshnessFinding[];
  candidates: DocumentFreshnessCandidateV1[];
  contents: Map<string, Buffer>;
  ownershipOf(path: string): DocumentFreshnessOwnership;
  policy: DocumentFreshnessPolicy;
  state: FreshnessCycleState;
  now: Date;
  autoApply: boolean;
  mandateKinds: readonly string[];
}) {
  const { context, candidates, contents, ownershipOf, policy, state, now, autoApply } = input;
  const storage = context.storage;
  const admission = { admitted: input.admitted };
  let candidateCount = 0;
  let verifiedCount = 0;
  let appliedCount = 0;
  let tokensObserved = 0;
  let disagreements = 0;
  let deferred: string | null = null;
  const recovery: NonNullable<FreshnessCycleState["evidenceRecovery"]> = {
    ...state.evidenceRecovery,
  };
  for (const entry of admission.admitted) {
    const workKey = freshnessRecoveryKey(entry, policy);
    const priorRecovery = state.evidenceRecovery?.[workKey];
    if (
      priorRecovery !== undefined &&
      priorRecovery.attempts >= 2 &&
      priorRecovery.nextCursor === null
    ) {
      recovery[workKey] = priorRecovery;
      continue;
    }
    const attempt = candidates.filter(
      (candidate) => candidate.findingDigest === entry.finding.findingDigest,
    ).length;
    let outcome: Awaited<ReturnType<typeof generateFreshnessCandidate>>;
    const predecessor = candidates.find(
      (candidate) =>
        candidate.documentPath === entry.finding.documentPath &&
        candidate.state === "superseded" &&
        candidate.rejection?.reasonCode === "candidate_invalid",
    );
    try {
      outcome = await generateFreshnessCandidate({
        context,
        entry,
        content: contents.get(entry.finding.documentPath)!,
        documentOwnership: ownershipOf(entry.finding.documentPath),
        attempt,
        policy,
        mandateKinds: input.mandateKinds,
        autoApply,
        ...(priorRecovery?.nextCursor == null ? {} : { evidenceCursor: priorRecovery.nextCursor }),
        ...(predecessor === undefined ? {} : { predecessorCandidateId: predecessor.candidateId }),
      });
    } catch (error) {
      if (error instanceof DocumentFreshnessOperationError) continue;
      throw error;
    }
    if (outcome.status === "evidence_deferred") {
      const attempts = Math.min(16, (priorRecovery?.attempts ?? 0) + 1);
      recovery[workKey] = {
        attempts,
        receiptHash: outcome.receiptHash,
        nextCursor: attempts >= 8 ? null : outcome.nextCursor,
        reason:
          attempts >= 2 && outcome.nextCursor === null
            ? "freshness_evidence_recovery_exhausted"
            : outcome.reason,
      };
      appendFreshnessMaintenanceEvent({
        storage,
        type: "document.freshness.evidence.recovered",
        receiptHash: (await storage.artifacts.put(canonicalJson({ workKey, ...recovery[workKey] })))
          .contentHash,
        occurredAt: now.toISOString(),
        payload: {
          findingDigest: entry.finding.findingDigest,
          documentHash: entry.finding.documentHash,
          evidenceContractHash: DOCUMENT_FRESHNESS_EVIDENCE_CONTRACT,
          outcome:
            attempts >= 2 && outcome.nextCursor === null
              ? "exhausted"
              : outcome.reason === "freshness_evidence_unavailable"
                ? "unavailable"
                : "incomplete",
          predecessorCandidateId: predecessor?.candidateId ?? null,
          attempt: attempts,
        },
      });
      continue;
    }
    if (outcome.status === "deferred") {
      // ADR-0587: a call abandoned for an upgrade is charged; it may have spent tokens.
      tokensObserved += outcome.tokensObserved ?? 0;
      state.budget.tokensUsed += outcome.tokensObserved ?? 0;
      deferred = outcome.reason;
      break;
    }
    delete recovery[workKey];
    candidateCount += 1;
    tokensObserved += outcome.tokensObserved;
    state.budget.tokensUsed += outcome.tokensObserved;
    state.budget.attempts += 1;
    if (
      [
        "verified",
        "verified_pending_cross_check",
        "waiting_authority",
        "applied",
        "partially_applied",
      ].includes(outcome.candidate.state)
    ) {
      verifiedCount += 1;
      state.budget.verified += 1;
    }
    if (outcome.candidate.state === "applied" || outcome.candidate.state === "partially_applied")
      appliedCount += 1;
    if (outcome.candidate.rejection?.reasonCode === "cross_check_disagreement") disagreements += 1;
  }
  return {
    candidateCount,
    verifiedCount,
    appliedCount,
    tokensObserved,
    disagreements,
    deferred,
    recovery,
  };
}
