import {
  buildDocumentFreshnessCrossCheckInput,
  canonicalJson,
  documentFreshnessAutoApplicableHunks,
  documentFreshnessCandidateNeedsCrossCheck,
  documentFreshnessCrossCheckInstruction,
  documentFreshnessCrossCheckResponseSchema,
  parseDocumentFreshnessCrossCheckResponse,
  pendingDocumentFreshnessCrossCheck,
  settleDocumentFreshnessCrossCheck,
  sha256,
  stableId,
  type DocumentFreshnessCandidateV1,
  type DocumentFreshnessCrossCheckInputV1,
  type DocumentFreshnessCrossCheckUnavailableReason,
  type DocumentFreshnessEvidenceItem,
} from "@lervo/repository-knowledge";
import type { ProjectStorage } from "@lervo/project-storage";

import { applyLervoManagedFreshnessHunks } from "./freshness-apply.js";
import { DocumentFreshnessOperationError } from "./freshness-document-io.js";
import { recordFreshnessCandidateOutcome } from "./freshness-events.js";
import {
  freshnessCallRunId,
  generateFreshnessProposal,
  type FreshnessGenerationContext,
} from "./freshness-generation.js";
import { writeFreshnessCandidate } from "./freshness-state-store.js";

export const DOCUMENT_FRESHNESS_CROSS_CHECK_TASK = "document_freshness_cross_check";
/** Turn-capacity deferrals a pending cross-check survives before it settles as unavailable. */
const MAXIMUM_CAPACITY_DEFERRALS = 8;
const ESTIMATED_BYTES_PER_TOKEN = 4;

export interface FreshnessCrossCheckResult {
  candidate: DocumentFreshnessCandidateV1;
  tokensObserved: number;
  status: "settled" | "pending";
}

/**
 * Stores the bounded Tier 0 input in CAS and parks the candidate as `generated` with a pending
 * cross-check, so it never reaches the owner queue or auto-apply before the reviewer answers.
 * Archives are not cross-checked; they settle as unavailable and keep the owner path.
 */
export async function prepareFreshnessCrossCheck(input: {
  storage: Pick<ProjectStorage, "artifacts">;
  candidate: DocumentFreshnessCandidateV1;
  source: Uint8Array;
  evidence: readonly DocumentFreshnessEvidenceItem[];
  now: string;
}): Promise<DocumentFreshnessCandidateV1> {
  const { candidate } = input;
  if (
    candidate.operation === "archive" &&
    candidate.state === "verified_pending_cross_check" &&
    candidate.crossCheck === "unavailable"
  )
    return settleDocumentFreshnessCrossCheck(candidate, {
      status: "unavailable",
      reason: "archive_not_cross_checked",
      runId: null,
      reviewerProvider: null,
      tokensObserved: 0,
      settledAt: input.now,
    });
  if (!documentFreshnessCandidateNeedsCrossCheck(candidate)) return candidate;
  const crossCheckInput = buildDocumentFreshnessCrossCheckInput({
    candidate,
    source: input.source,
    evidence: input.evidence,
  });
  const stored = await input.storage.artifacts.put(canonicalJson(crossCheckInput));
  return {
    ...candidate,
    state: "generated",
    crossCheckReview: pendingDocumentFreshnessCrossCheck(stored.contentHash),
  };
}

export function freshnessCrossCheckPending(candidate: DocumentFreshnessCandidateV1): boolean {
  return candidate.state === "generated" && candidate.crossCheckReview?.status === "pending";
}

async function readCrossCheckInput(
  storage: Pick<ProjectStorage, "artifacts">,
  inputHash: string | null,
): Promise<{ value: DocumentFreshnessCrossCheckInputV1; bytes: number } | null> {
  if (inputHash === null || !/^sha256:[a-f0-9]{64}$/u.test(inputHash)) return null;
  try {
    const bytes = await storage.artifacts.get(`lervo-cas://sha256/${inputHash.slice(7)}`);
    if (sha256(bytes) !== inputHash) return null;
    const value = JSON.parse(
      new TextDecoder("utf8", { fatal: true }).decode(bytes),
    ) as DocumentFreshnessCrossCheckInputV1;
    return value.kind === "document_freshness.cross_check_input"
      ? { value, bytes: bytes.byteLength }
      : null;
  } catch {
    return null;
  }
}

async function settle(input: {
  context: FreshnessGenerationContext;
  candidate: DocumentFreshnessCandidateV1;
  settlement: Parameters<typeof settleDocumentFreshnessCrossCheck>[1];
}): Promise<FreshnessCrossCheckResult> {
  const next = settleDocumentFreshnessCrossCheck(input.candidate, input.settlement);
  await writeFreshnessCandidate(input.context.storage.paths.repositoryRoot, next);
  recordFreshnessCandidateOutcome({
    storage: input.context.storage,
    candidate: next,
    documentHash: next.sourceHash,
    occurredAt: next.updatedAt,
    created: false,
  });
  return { candidate: next, tokensObserved: input.settlement.tokensObserved, status: "settled" };
}

/**
 * One ADR-0557 Tier 0 call in a fresh no-capability session, separate from the generation call.
 * It shares generation's admission, ceilings, and usage records, and its tokens count inside the
 * candidate budget. Every failure settles as `unavailable` with its reason; only a valid verdict
 * for every hunk can agree. A turn without provider capacity leaves the call pending.
 */
export async function runFreshnessCrossCheck(input: {
  context: FreshnessGenerationContext;
  candidate: DocumentFreshnessCandidateV1;
  maximumTokens: number;
}): Promise<FreshnessCrossCheckResult> {
  const { context, candidate } = input;
  const review = candidate.crossCheckReview;
  if (!freshnessCrossCheckPending(candidate) || review === undefined)
    return { candidate, tokensObserved: 0, status: "settled" };
  const unavailable = (
    reason: DocumentFreshnessCrossCheckUnavailableReason,
    tokensObserved = 0,
    runId: string | null = null,
    reviewerProvider: "codex" | "claude" | null = null,
  ) =>
    settle({
      context,
      candidate,
      settlement: {
        status: "unavailable",
        reason,
        runId,
        reviewerProvider,
        tokensObserved,
        settledAt: context.now().toISOString(),
      },
    });
  const stored = await readCrossCheckInput(context.storage, review.inputHash);
  if (stored === null) return unavailable("cross_check_input_unavailable");
  const remaining = Math.max(0, input.maximumTokens - candidate.tokensObserved);
  const estimated = Math.ceil(
    (stored.bytes +
      Buffer.byteLength(documentFreshnessCrossCheckInstruction, "utf8") +
      Buffer.byteLength(JSON.stringify(documentFreshnessCrossCheckResponseSchema), "utf8")) /
      ESTIMATED_BYTES_PER_TOKEN,
  );
  if (estimated > remaining) return unavailable("freshness_budget_exhausted");
  const generationId = stableId("kfg", [
    candidate.candidateId,
    "tier0_cross_check",
    review.inputHash,
  ]);
  const runId = freshnessCallRunId(generationId);
  const result = await generateFreshnessProposal({
    context,
    source: {
      sourceData: stored.value,
      documents: [
        {
          path: stored.value.document.path,
          hash: stored.value.document.hash,
          text: stored.value.hunks
            .map((hunk) => `${hunk.contextBefore}${hunk.before}${hunk.contextAfter}`)
            .join("\n"),
        },
      ],
      sourceRevision: stored.value.document.hash,
    },
    generationId,
    task: DOCUMENT_FRESHNESS_CROSS_CHECK_TASK,
    responseSchema: documentFreshnessCrossCheckResponseSchema,
    prompt: documentFreshnessCrossCheckInstruction,
  });
  if (result.status === "deferred") {
    if (
      result.reason === "knowledge_capacity_unavailable" &&
      review.deferrals + 1 < MAXIMUM_CAPACITY_DEFERRALS
    ) {
      const next: DocumentFreshnessCandidateV1 = {
        ...candidate,
        crossCheckReview: { ...review, deferrals: review.deferrals + 1 },
        updatedAt: context.now().toISOString(),
      };
      await writeFreshnessCandidate(context.storage.paths.repositoryRoot, next);
      return { candidate: next, tokensObserved: 0, status: "pending" };
    }
    return unavailable(result.reason);
  }
  // A call that may have reached the model with unobserved usage is charged at the remaining bound.
  if (result.status === "failed")
    return unavailable("cross_check_provider_failed", remaining, runId);
  if (result.usage === null)
    return unavailable("cross_check_usage_unavailable", remaining, runId, result.provider);
  const observed = result.usage.totalTokens;
  if (observed > remaining)
    return unavailable("freshness_budget_exhausted", observed, runId, result.provider);
  const verdicts = parseDocumentFreshnessCrossCheckResponse(
    result.value,
    candidate.hunks.map((hunk) => hunk.hunkId),
  );
  if (verdicts === null)
    return unavailable("cross_check_response_invalid", observed, runId, result.provider);
  return settle({
    context,
    candidate,
    settlement: {
      status: "verdicts",
      verdicts,
      runId,
      reviewerProvider: result.provider,
      tokensObserved: observed,
      settledAt: context.now().toISOString(),
    },
  });
}

/** Lervo applies its own hunks once a settled candidate is `verified`; other states wait. */
export async function applyCrossCheckedFreshnessHunks(
  context: FreshnessGenerationContext,
  candidate: DocumentFreshnessCandidateV1,
): Promise<DocumentFreshnessCandidateV1> {
  const automatic = documentFreshnessAutoApplicableHunks(candidate);
  if (candidate.state !== "verified" || candidate.operation !== "edit" || automatic.length === 0)
    return candidate;
  return applyLervoManagedFreshnessHunks({
    storage: context.storage,
    candidate,
    hunkIds: new Set(automatic.map((hunk) => hunk.hunkId)),
    now: context.now(),
  });
}

/**
 * Resumes cross-checks a previous turn left pending, oldest first, until one stays pending for
 * lack of provider capacity. Settled agreement applies Lervo's own hunks when effects allow.
 */
export async function resumePendingFreshnessCrossChecks(input: {
  context: FreshnessGenerationContext;
  candidates: readonly DocumentFreshnessCandidateV1[];
  maximumTokens: number;
  autoApply: boolean;
}): Promise<{
  tokensObserved: number;
  verifiedCount: number;
  appliedCount: number;
  disagreements: number;
  pending: boolean;
}> {
  const totals = {
    tokensObserved: 0,
    verifiedCount: 0,
    appliedCount: 0,
    disagreements: 0,
    pending: false,
  };
  const pending = input.candidates
    .filter(freshnessCrossCheckPending)
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  for (const candidate of pending) {
    const result = await runFreshnessCrossCheck({
      context: input.context,
      candidate,
      maximumTokens: input.maximumTokens,
    });
    totals.tokensObserved += result.tokensObserved;
    if (result.status === "pending") {
      totals.pending = true;
      break;
    }
    if (result.candidate.state === "rejected") {
      totals.disagreements += 1;
      continue;
    }
    totals.verifiedCount += 1;
    if (!input.autoApply) continue;
    try {
      const applied = await applyCrossCheckedFreshnessHunks(input.context, result.candidate);
      if (applied.state === "applied" || applied.state === "partially_applied")
        totals.appliedCount += 1;
    } catch (error) {
      if (!(error instanceof DocumentFreshnessOperationError)) throw error;
    }
  }
  return totals;
}
