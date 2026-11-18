import {
  buildDocumentFreshnessArchiveCrossCheckInput,
  buildDocumentFreshnessCrossCheckInput,
  canonicalJson,
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
 * cross-check, so Lervo applies nothing before the reviewer answers. Archives are cross-checked
 * too, with the move and the inbound link rewrites as items (ADR-0561).
 */
export async function prepareFreshnessCrossCheck(input: {
  storage: Pick<ProjectStorage, "artifacts">;
  candidate: DocumentFreshnessCandidateV1;
  source: Uint8Array;
  evidence: readonly DocumentFreshnessEvidenceItem[];
}): Promise<DocumentFreshnessCandidateV1> {
  const { candidate } = input;
  if (!documentFreshnessCandidateNeedsCrossCheck(candidate)) return candidate;
  const crossCheckInput =
    candidate.operation === "archive" && candidate.archive !== null
      ? buildDocumentFreshnessArchiveCrossCheckInput({
          candidate: { ...candidate, archive: candidate.archive },
          source: input.source,
          evidence: input.evidence,
        })
      : buildDocumentFreshnessCrossCheckInput({
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

const otherProvider = { codex: "claude", claude: "codex" } as const;

/**
 * The context for one round. ADR-0561 prefers a different admitted provider for the second of two
 * required checks: a resident that resolves its provider by detection asks for the other provider
 * first and falls back to its own when the other is not admitted. A configured executable binds
 * the provider, so that round runs in another fresh session of the same provider.
 */
function roundContext(
  context: FreshnessGenerationContext,
  candidate: DocumentFreshnessCandidateV1,
): FreshnessGenerationContext {
  const previous = candidate.crossCheckRounds?.at(-1)?.reviewerProvider;
  if (previous === undefined || previous === null || context.executable !== undefined)
    return context;
  return { ...context, provider: otherProvider[previous] };
}

/**
 * One ADR-0557 Tier 0 round in a fresh no-capability session, separate from the generation call
 * and from every earlier round. It shares generation's admission, ceilings, and usage records, and
 * its tokens count inside the candidate budget. Every failure settles as `unavailable` with its
 * reason; only a valid verdict for every item can agree. A turn without capacity leaves it pending.
 */
async function runFreshnessCrossCheckRound(input: {
  context: FreshnessGenerationContext;
  candidate: DocumentFreshnessCandidateV1;
  maximumTokens: number;
  dailyRemaining?: number;
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
  // A call can be charged up to the whole remaining candidate budget, so the daily budget must
  // afford that bound. It resets; until then the cross-check waits without counting a deferral.
  if (remaining > (input.dailyRemaining ?? Number.POSITIVE_INFINITY))
    return { candidate, tokensObserved: 0, status: "pending" };
  // Each round and each retry is its own session and run; the first keeps the ADR-0557 identity.
  const round = candidate.crossCheckRounds?.length ?? 0;
  const retries = review.retries ?? 0;
  const generationId = stableId("kfg", [
    candidate.candidateId,
    "tier0_cross_check",
    review.inputHash,
    ...(round === 0 && retries === 0 ? [] : [round, retries]),
  ]);
  const runId = freshnessCallRunId(generationId);
  const result = await generateFreshnessProposal({
    context: roundContext(context, candidate),
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
  // A call that reached the provider and then failed may have spent tokens: charge the bound.
  if (result.status === "deferred" && result.attempted === true)
    return unavailable(result.reason, remaining, runId);
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
    stored.value.hunks.map((hunk) => hunk.hunkId),
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

/**
 * Runs Tier 0 rounds until the candidate settles or a round must wait: a candidate that needs two
 * independent agreeing checks runs its second round right after the first agrees, when capacity
 * allows. Each round's spend is reported before the next round starts.
 */
export async function runFreshnessCrossCheck(input: {
  context: FreshnessGenerationContext;
  candidate: DocumentFreshnessCandidateV1;
  maximumTokens: number;
  /** Tokens left in the repository's daily freshness budget; absent means already reserved. */
  dailyRemaining?: number;
  recordSpend?: (tokens: number) => Promise<void>;
}): Promise<FreshnessCrossCheckResult> {
  let candidate = input.candidate;
  let tokensObserved = 0;
  for (;;) {
    const result = await runFreshnessCrossCheckRound({
      context: input.context,
      candidate,
      maximumTokens: input.maximumTokens,
      ...(input.dailyRemaining === undefined
        ? {}
        : { dailyRemaining: Math.max(0, input.dailyRemaining - tokensObserved) }),
    });
    candidate = result.candidate;
    tokensObserved += result.tokensObserved;
    if (result.tokensObserved > 0) await input.recordSpend?.(result.tokensObserved);
    if (result.status === "pending" || !freshnessCrossCheckPending(candidate))
      return { candidate, tokensObserved, status: result.status };
  }
}

/**
 * Records one capacity deferral for a pending cross-check that this turn did not reach. At the
 * bound it settles as unavailable, so no waiting candidate stays pending without limit.
 */
export async function deferPendingFreshnessCrossCheck(
  context: FreshnessGenerationContext,
  candidate: DocumentFreshnessCandidateV1,
): Promise<void> {
  const review = candidate.crossCheckReview;
  if (review === undefined || review === null) return;
  if (review.deferrals + 1 >= MAXIMUM_CAPACITY_DEFERRALS) {
    await settle({
      context,
      candidate,
      settlement: {
        status: "unavailable",
        reason: "knowledge_capacity_unavailable",
        runId: null,
        reviewerProvider: null,
        tokensObserved: 0,
        settledAt: context.now().toISOString(),
      },
    });
    return;
  }
  await writeFreshnessCandidate(context.storage.paths.repositoryRoot, {
    ...candidate,
    crossCheckReview: { ...review, deferrals: review.deferrals + 1 },
    updatedAt: context.now().toISOString(),
  });
}
