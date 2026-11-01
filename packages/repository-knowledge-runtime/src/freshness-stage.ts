import {
  admitDocumentFreshnessFindings,
  documentFreshnessFindingsDigest,
  documentFreshnessOwnershipResolver,
  documentFreshnessPolicy,
  documentFreshnessPriorityClass,
  documentFreshnessReviewStates,
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
import { reviewPendingFreshnessAssessment } from "./freshness-assessment.js";
import {
  freshnessCrossCheckPending,
  resumePendingFreshnessCrossChecks,
} from "./freshness-cross-check.js";
import {
  listFreshnessCandidates,
  listFreshnessHolds,
  pruneFreshnessState,
  readFreshnessCycleState,
  writeFreshnessCycleState,
  type FreshnessCycleState,
} from "./freshness-state-store.js";

const ZERO_SUCCESS_ATTEMPTS = 5;
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
 * The ADR-0463 freshness stage of the knowledge resident. It runs only when its fence changed,
 * admits findings by priority and budget, generates and verifies candidates through the governed
 * provider path, applies Lervo's own verified hunks, and holds everything else for the owner.
 */
export async function runDocumentFreshnessCycle(input: {
  context: FreshnessGenerationContext;
  /** Decision kinds of the installed principal mandate; version 1 installs none. */
  mandateKinds?: readonly string[];
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
  if (
    key !== null &&
    key === state.observationKey &&
    !candidates.some(
      (candidate) => candidate.state === "generated" && candidate.operation === "no_change_needed",
    ) &&
    !(
      input.effects !== "prepare" &&
      candidates.some(
        (candidate) => candidate.state === "verified" && candidate.operation === "edit",
      )
    ) &&
    !candidates.some(freshnessCrossCheckPending) &&
    !Object.values(state.evidenceRecovery ?? {}).some(
      (item) => item.attempts < 2 || item.nextCursor !== null,
    )
  )
    return { status: "unchanged" };
  await pruneFreshnessState(root, now);
  candidates = await recoverFreshnessCandidates(context, await listFreshnessCandidates(root));
  candidates = await supersedeMovedCandidates(context, candidates);
  if (input.effects !== "prepare") await resumeVerifiedCandidates(context, candidates);
  // A cross-check a previous turn left pending runs before new spend; its tokens were reserved
  // inside the candidate budget when the finding was admitted.
  const crossChecks = await resumePendingFreshnessCrossChecks({
    context,
    candidates,
    maximumTokens: policy.maximumTokensPerCandidate,
    dailyRemaining: Math.max(0, policy.maximumTokensPerDay - state.budget.tokensUsed),
    autoApply: input.effects !== "prepare",
  });
  state.budget.tokensUsed += crossChecks.tokensObserved;
  state.budget.verified += crossChecks.verifiedCount;
  // Settled cross-check spend is recorded before any later step can fail, so it is never reused.
  if (crossChecks.tokensObserved > 0) await writeFreshnessCycleState(root, state);
  const pendingAssessment = candidates.find(
    (candidate) => candidate.state === "generated" && candidate.operation === "no_change_needed",
  );
  if (
    pendingAssessment !== undefined &&
    state.budget.tokensUsed + policy.maximumTokensPerCandidate <= policy.maximumTokensPerDay
  ) {
    const review = await reviewPendingFreshnessAssessment(
      context,
      pendingAssessment,
      policy.maximumTokensPerCandidate,
    );
    state.budget.tokensUsed += review.tokensObserved;
    if (review.candidate.state === "verified") state.budget.verified += 1;
    const cycleId = stableId("kfcy", [pendingAssessment.candidateId, now.toISOString()]);
    const finalCandidates = await listFreshnessCandidates(root);
    state.summary.awaitingReviewCount = finalCandidates.filter((candidate) =>
      documentFreshnessReviewStates.has(candidate.state),
    ).length;
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
        verifiedCount: (review.candidate.state === "verified" ? 1 : 0) + crossChecks.verifiedCount,
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
  const admission = admitDocumentFreshnessFindings({
    ordered: ordered.filter((entry) => {
      const recovery = state.evidenceRecovery?.[freshnessRecoveryKey(entry, policy)];
      return recovery === undefined || recovery.attempts < 2 || recovery.nextCursor !== null;
    }),
    candidates,
    holds,
    tokensUsedToday: state.budget.tokensUsed,
    policy: cyclePolicy,
    now,
  });
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
    mandateKinds: input.mandateKinds ?? [],
  });
  const { candidateCount, deferred, recovery } = findingWork;
  const verifiedCount = findingWork.verifiedCount + crossChecks.verifiedCount;
  const appliedCount = findingWork.appliedCount + crossChecks.appliedCount;
  const tokensObserved = findingWork.tokensObserved + crossChecks.tokensObserved;
  const findingsDigest = documentFreshnessFindingsDigest(observation.findings);
  const blocked = state.budget.attempts >= ZERO_SUCCESS_ATTEMPTS && state.budget.verified === 0;
  const finalCandidates = await listFreshnessCandidates(root);
  const cycleId = stableId("kfcy", { key, findingsDigest, at: now.toISOString() });
  const next: FreshnessCycleState = {
    schemaVersion: 1,
    observationKey: null,
    findingsDigest,
    firstSeen: Object.fromEntries(Object.entries(firstSeen).slice(0, MAXIMUM_FIRST_SEEN)),
    budget: state.budget,
    summary: summarize({ findings: ordered, candidates: finalCandidates, blocked, now }),
    lastCycleAt: now.toISOString(),
    evidenceRecovery: Object.fromEntries(
      Object.entries(recovery)
        .filter(([recoveryKey]) => activeRecoveryKeys.has(recoveryKey))
        .slice(-MAXIMUM_FIRST_SEEN),
    ),
  };
  appendFreshnessEvent({
    storage,
    type: "document.freshness.cycle.completed",
    correlationId: cycleId,
    coordinate: null,
    occurredAt: now.toISOString(),
    payload: {
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
    },
  });
  // The fence is recorded after this cycle's own writes, so only a later change runs the stage.
  // A deferred call, findings left by the per-cycle count, a pending cross-check, or a cross-check
  // disagreement (whose finding regenerates once) keep the stage running next cycle.
  next.observationKey =
    deferred === null &&
    admission.skippedForCycleLimit === 0 &&
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

import { observationKey, workingBytes, summarize } from "./freshness-cycle-observation.js";

import { freshnessRecoveryKey, processFreshnessFindings } from "./freshness-finding-work.js";
