import { reviewUnlessUsagePaused, expireUsagePause } from "./freshness-usage-pause.js";
import {
  admitDocumentFreshnessFindings,
  documentFreshnessFindingsDigest,
  documentFreshnessOwnershipResolver,
  documentFreshnessPolicy,
  documentFreshnessPriorityClass,
  documentFreshnessHeldStates,
  loadRepositoryKnowledgePolicy,
  observeDocumentFreshnessFindings,
  orderDocumentFreshnessFindings,
  stableId,
  DOCUMENT_FRESHNESS_EVIDENCE_CONTRACT,
  type PrioritizedDocumentFreshnessFinding,
} from "@lervo/repository-knowledge";

import { committedBlob } from "./freshness-commit.js";
import { appendFreshnessEvent, FRESHNESS_EVENT_SCHEMA_VERSION } from "./freshness-events.js";
import type { FreshnessGenerationContext } from "./freshness-generation.js";
import {
  recoverFreshnessCandidates,
  supersedeMovedCandidates,
  resumeVerifiedCandidates,
} from "./freshness-candidate-recovery.js";
import { freshnessCrossCheckPending } from "./freshness-cross-check.js";
import {
  rearmFreshnessCrossChecks,
  resumePendingFreshnessCrossChecks,
} from "./freshness-cross-check-schedule.js";
import {
  freshnessBackoffDue,
  freshnessZeroSuccessHoldActive,
  nextFreshnessDebt,
  nextFreshnessZeroSuccessHold,
} from "./freshness-debt-state.js";
import {
  listFreshnessCandidates,
  listFreshnessHolds,
  pruneFreshnessState,
  readFreshnessCycleState,
  writeFreshnessCycleState,
  type FreshnessCycleState,
} from "./freshness-state-store.js";

const MAXIMUM_FIRST_SEEN = 512;

export type DocumentFreshnessCycleResult =
  /** `yielded`: convergence had a stage in flight, so the stage waited for the next cycle. */
  | { status: "disabled" | "unavailable" | "unchanged" | "yielded" }
  | {
      status: "completed";
      cycleId: string;
      findingCount: number;
      admittedCount: number;
      candidateCount: number;
      verifiedCount: number;
      appliedCount: number;
      deferred: string | null;
    };

/**
 * The ADR-0463 freshness stage of the knowledge resident. It runs only when its fence changed or a
 * backoff elapsed, admits findings by priority and budget, generates and verifies candidates
 * through the governed provider path, and applies what the independent cross-check agreed. What
 * Lervo cannot resolve it holds as its own debt with backoff (ADR-0561); nothing waits for the owner.
 */
export async function runDocumentFreshnessCycle(input: {
  context: FreshnessGenerationContext;
  /** Preparation cannot commit inside a convergence batch. */
  effects?: "prepare" | "apply";
  maximumCandidates?: number;
}): Promise<DocumentFreshnessCycleResult> {
  const { context } = input;
  const storage = context.storage;
  const root = storage.paths.repositoryRoot;
  const policy = documentFreshnessPolicy(await loadRepositoryKnowledgePolicy(root));
  const cyclePolicy = {
    ...policy,
    maximumCandidatesPerCycle: Math.min(
      policy.maximumCandidatesPerCycle,
      Math.max(1, input.maximumCandidates ?? policy.maximumCandidatesPerCycle),
    ),
  };
  if (!policy.enabled) return { status: "disabled" };
  if ((storage.writableEventSchemaVersion ?? 1) < FRESHNESS_EVENT_SCHEMA_VERSION)
    return { status: "unavailable" };
  const now = context.now();
  const day = now.toISOString().slice(0, 10);
  const state: FreshnessCycleState = await readFreshnessCycleState(root);
  if (state.budget.day !== day) state.budget = { day, tokensUsed: 0, attempts: 0, verified: 0 };
  const holds = await listFreshnessHolds(root);
  let candidates = await listFreshnessCandidates(root);
  const key = await observationKey(root, {
    policy,
    evidenceContract: DOCUMENT_FRESHNESS_EVIDENCE_CONTRACT,
    day,
    holds: holds.map((hold) => [hold.findingDigest, hold.until]),
    candidates: candidates.map((candidate) => [
      candidate.candidateId,
      candidate.state,
      candidate.updatedAt,
    ]),
  });
  // ADR-0580: a pending no-change assessment reopens the stage only when today's budget can pay
  // for its review. Otherwise every cycle would observe again, append the same cycle event, and
  // wake the resident that just finished; the day in the key reopens the stage with a new budget.
  const reviewAffordable =
    state.budget.tokensUsed + policy.maximumTokensPerCandidate <= policy.maximumTokensPerDay;
  if (
    key !== null &&
    key === state.observationKey &&
    !(
      reviewAffordable &&
      candidates.some(
        (candidate) =>
          candidate.state === "generated" && candidate.operation === "no_change_needed",
      )
    ) &&
    !(
      input.effects !== "prepare" &&
      candidates.some(
        (candidate) => candidate.state === "verified" && candidate.operation === "edit",
      )
    ) &&
    !candidates.some(freshnessCrossCheckPending) &&
    !freshnessBackoffDue(state, candidates, now, { debtAffordable: reviewAffordable }) &&
    !Object.values(state.evidenceRecovery ?? {}).some(
      (item) => item.attempts < 2 || item.nextCursor !== null,
    )
  )
    return { status: "unchanged" };
  // ADR-0604: an ended pause was due this once; written now, since some exits below write nothing.
  if (expireUsagePause(state, now)) await writeFreshnessCycleState(root, state);
  await pruneFreshnessState(root, now);
  candidates = await recoverFreshnessCandidates(context, await listFreshnessCandidates(root));
  candidates = await supersedeMovedCandidates(context, candidates);
  candidates = await rearmFreshnessCrossChecks(context, candidates);
  if (input.effects !== "prepare") await resumeVerifiedCandidates(context, candidates);
  // A cross-check a previous turn left pending runs before new spend; its tokens were reserved
  // inside the candidate budget when the finding was admitted.
  const crossChecks = await resumePendingFreshnessCrossChecks({
    context,
    candidates,
    maximumTokens: policy.maximumTokensPerCandidate,
    dailyRemaining: Math.max(0, policy.maximumTokensPerDay - state.budget.tokensUsed),
    // Each settled spend is written at once, before auto-apply or the next candidate can fail.
    recordSpend: async (tokens) => {
      state.budget.tokensUsed += tokens;
      await writeFreshnessCycleState(root, state);
    },
    autoApply: input.effects !== "prepare",
  });
  state.budget.verified += crossChecks.verifiedCount;
  const pendingAssessment = candidates.find(
    (candidate) => candidate.state === "generated" && candidate.operation === "no_change_needed",
  );
  if (
    pendingAssessment !== undefined &&
    state.budget.tokensUsed + policy.maximumTokensPerCandidate <= policy.maximumTokensPerDay
  ) {
    const review = await reviewUnlessUsagePaused(context, state, pendingAssessment, {
      now,
      maximumTokens: policy.maximumTokensPerCandidate,
    });
    state.budget.tokensUsed += review.tokensObserved;
    if (review.candidate.state === "verified") state.budget.verified += 1;
    const cycleId = stableId("kfcy", [pendingAssessment.candidateId, now.toISOString()]);
    const finalCandidates = await listFreshnessCandidates(root);
    state.summary.awaitingReviewCount = finalCandidates.filter((candidate) =>
      documentFreshnessHeldStates.has(candidate.state),
    ).length;
    state.debt = nextFreshnessDebt(state, finalCandidates, now);
    state.summary.debt = freshnessDebtSummary(state.debt);
    const reviewVerified =
      (review.candidate.state === "verified" ? 1 : 0) + crossChecks.verifiedCount;
    // The key stays null, so the next cycle retries the review; only the event is withheld.
    if (
      !deferredWithoutProgress({
        deferred: review.deferred,
        candidateCount: 0,
        verifiedCount: reviewVerified,
        appliedCount: crossChecks.appliedCount,
        tokensObserved: review.tokensObserved + crossChecks.tokensObserved,
      })
    )
      appendFreshnessEvent({
        storage,
        type: "document.freshness.cycle.completed",
        correlationId: cycleId,
        coordinate: null,
        occurredAt: now.toISOString(),
        payload: {
          cycleId,
          findingCount: state.summary.staleCount,
          admittedCount: 0,
          candidateCount: 0,
          verifiedCount: reviewVerified,
          appliedCount: crossChecks.appliedCount,
          skippedForBudget: 0,
          skippedForHold: 0,
          usageObserved: review.tokensObserved + crossChecks.tokensObserved,
          occurredAt: now.toISOString(),
        },
      });
    await writeFreshnessCycleState(root, {
      ...state,
      observationKey: null,
      lastCycleAt: now.toISOString(),
    });
    return {
      status: "completed",
      cycleId,
      findingCount: state.summary.staleCount,
      admittedCount: 0,
      candidateCount: 0,
      verifiedCount: (review.candidate.state === "verified" ? 1 : 0) + crossChecks.verifiedCount,
      appliedCount: crossChecks.appliedCount,
      deferred: review.deferred,
    };
  }
  candidates = await listFreshnessCandidates(root);
  let observation: Awaited<ReturnType<typeof observeDocumentFreshnessFindings>>;
  try {
    observation = await observeDocumentFreshnessFindings({ repositoryRoot: root, now });
  } catch {
    // A pending materialization transaction or unreadable policy defers freshness to a later cycle.
    return { status: "unavailable" };
  }
  if (observation.status !== "observed") return { status: "unavailable" };
  const ownershipOf = await documentFreshnessOwnershipResolver(root);
  const firstSeen: Record<string, string> = {};
  const contents = new Map<string, Buffer>();
  const prioritized: PrioritizedDocumentFreshnessFinding[] = [];
  for (const finding of observation.findings) {
    const bytes = await workingBytes(root, finding.documentPath);
    const committed = await committedBlob(root, finding.documentPath);
    // Uncommitted edits belong to whoever is editing; the document waits until they settle.
    if (bytes === null || committed === null || !bytes.equals(committed)) continue;
    firstSeen[finding.findingDigest] = state.firstSeen[finding.findingDigest] ?? now.toISOString();
    const timed = { ...finding, detectedAt: firstSeen[finding.findingDigest]! };
    contents.set(finding.documentPath, bytes);
    prioritized.push({
      finding: timed,
      priorityClass: documentFreshnessPriorityClass({
        finding: timed,
        content: bytes.toString("utf8"),
        policy,
      }),
    });
  }
  const ordered = orderDocumentFreshnessFindings(prioritized);
  const admitted = admitDocumentFreshnessFindings({
    ordered: ordered.filter((entry) => {
      const recovery = state.evidenceRecovery?.[freshnessRecoveryKey(entry, policy)];
      return recovery === undefined || recovery.attempts < 2 || recovery.nextCursor !== null;
    }),
    candidates,
    holds,
    debt: state.debt ?? [],
    tokensUsedToday: state.budget.tokensUsed,
    policy: cyclePolicy,
    now,
  });
  // ADR-0561: the zero-success hold pauses new generation; held cross-checks above still run.
  const admission = freshnessZeroSuccessHoldActive(state, now)
    ? {
        ...admitted,
        admitted: [],
        skippedForHold: admitted.skippedForHold + admitted.admitted.length,
      }
    : admitted;
  const activeRecoveryKeys = new Set(ordered.map((entry) => freshnessRecoveryKey(entry, policy)));
  const findingWork = await processFreshnessFindings({
    context,
    admitted: admission.admitted,
    candidates,
    contents,
    ownershipOf,
    policy,
    state,
    now,
    autoApply: input.effects !== "prepare",
  });
  const { candidateCount, deferred, recovery } = findingWork;
  const backlinks = await applyReverseHeaderEdits({ context, policy, effects: input.effects });
  const verifiedCount = findingWork.verifiedCount + crossChecks.verifiedCount;
  const appliedCount = findingWork.appliedCount + crossChecks.appliedCount + backlinks.appliedCount;
  const tokensObserved = findingWork.tokensObserved + crossChecks.tokensObserved;
  const findingsDigest = documentFreshnessFindingsDigest(observation.findings);
  const finalCandidates = await listFreshnessCandidates(root);
  const zeroSuccessHold = nextFreshnessZeroSuccessHold(state, now);
  const debt = nextFreshnessDebt(state, finalCandidates, now);
  const blocked = zeroSuccessHold !== null;
  const cycleId = stableId("kfcy", { key, findingsDigest, at: now.toISOString() });
  const next: FreshnessCycleState = {
    schemaVersion: 1,
    observationKey: null,
    findingsDigest,
    firstSeen: Object.fromEntries(Object.entries(firstSeen).slice(0, MAXIMUM_FIRST_SEEN)),
    budget: state.budget,
    summary: summarize({ findings: ordered, candidates: finalCandidates, blocked, debt, now }),
    lastCycleAt: now.toISOString(),
    evidenceRecovery: Object.fromEntries(
      Object.entries(recovery)
        .filter(([recoveryKey]) => activeRecoveryKeys.has(recoveryKey))
        .slice(-MAXIMUM_FIRST_SEEN),
    ),
    debt,
    zeroSuccessHold,
    // ADR-0604: the usage count and pause outlive the cycle that recorded them.
    ...(state.usageUnavailable === undefined ? {} : { usageUnavailable: state.usageUnavailable }),
  };
  const payload = {
    cycleId,
    findingCount: observation.findings.length,
    admittedCount: admission.admitted.length,
    candidateCount,
    verifiedCount,
    appliedCount,
    skippedForBudget: admission.skippedForBudget,
    skippedForHold: admission.skippedForHold,
    usageObserved: tokensObserved,
    occurredAt: now.toISOString(),
  };
  // A cycle over the same findings that made no progress and reports nothing new records nothing
  // (ADR-0580, generalized by ADR-0598).
  const outcomeDigest = freshnessOutcomeDigest(payload);
  next.lastOutcomeDigest = state.lastOutcomeDigest ?? null;
  if (
    freshnessCycleNewsworthy({
      previous: state,
      findingsDigest,
      outcomeDigest,
      outcome: {
        deferred,
        admittedCount: admission.admitted.length,
        candidateCount,
        verifiedCount,
        appliedCount,
        tokensObserved,
      },
    })
  ) {
    appendFreshnessEvent({
      storage,
      type: "document.freshness.cycle.completed",
      correlationId: cycleId,
      coordinate: null,
      occurredAt: now.toISOString(),
      payload,
    });
    next.lastOutcomeDigest = outcomeDigest;
  }
  // The fence is recorded after this cycle's own writes, so only a later change runs the stage.
  // A deferred call, findings left by the per-cycle count, a pending cross-check, or a cross-check
  // disagreement (whose finding regenerates once) keep the stage running next cycle.
  next.observationKey =
    deferred === null &&
    admission.skippedForCycleLimit === 0 &&
    !backlinks.remaining &&
    !crossChecks.pending &&
    crossChecks.disagreements + findingWork.disagreements === 0
      ? await observationKey(root, {
          policy,
          evidenceContract: DOCUMENT_FRESHNESS_EVIDENCE_CONTRACT,
          day,
          holds: (await listFreshnessHolds(root)).map((hold) => [hold.findingDigest, hold.until]),
          candidates: finalCandidates.map((candidate) => [
            candidate.candidateId,
            candidate.state,
            candidate.updatedAt,
          ]),
        })
      : null;
  await writeFreshnessCycleState(root, next);
  return {
    status: "completed",
    cycleId,
    findingCount: observation.findings.length,
    admittedCount: admission.admitted.length,
    candidateCount,
    verifiedCount,
    appliedCount,
    deferred,
  };
}

import {
  deferredWithoutProgress,
  freshnessCycleNewsworthy,
  freshnessDebtSummary,
  freshnessOutcomeDigest,
  observationKey,
  workingBytes,
  summarize,
} from "./freshness-cycle-observation.js";

import { freshnessRecoveryKey, processFreshnessFindings } from "./freshness-finding-work.js";
import { applyReverseHeaderEdits } from "./freshness-reverse-headers.js";
