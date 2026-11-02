import {
  listDurableInstructionCandidates,
  parseInstructionCaptureAssessment,
  scanConfiguredRepositoryKnowledge,
  inspectDurableInstructionCatalog,
  stableId,
  type DurableInstructionCatalogInspection,
} from "@lervo/repository-knowledge";
import { settleInstructionCapture } from "./instruction-capture-settlement.js";
import { preparePracticeCapture, completePracticeCapture } from "./practice-capture.js";
import { releaseUnattemptedPracticeBudget } from "./practice-budget.js";

import {
  assessInstructionCapture,
  type InstructionCaptureContext,
} from "./instruction-capture-assessment.js";
import {
  appendInstructionCaptureEvent,
  INSTRUCTION_CAPTURE_EVENT_SCHEMA_VERSION,
} from "./instruction-capture-events.js";
import {
  listQueuedInstructionCaptures,
  pruneInstructionCaptureQueue,
  recordInstructionCaptureAttempt,
  removeQueuedInstructionCapture,
} from "./instruction-capture-queue.js";
import {
  captureBudgetAvailable,
  currentCaptureBudget,
  MAXIMUM_ASSESSMENTS_PER_CYCLE,
  readInstructionCaptureState,
  writeInstructionCaptureState,
} from "./instruction-capture-state.js";

const MAXIMUM_ATTEMPTS = 3;

export type InstructionCaptureCycleResult =
  | { status: "idle" | "unavailable" }
  | {
      status: "completed";
      cycleId: string;
      assessedCount: number;
      instructionCandidateCount: number;
      decisionCount: number;
      deferred: string | null;
    };

interface CycleCounts {
  assessedCount: number;
  instructionCandidateCount: number;
  decisionCount: number;
  ignoredCount: number;
  personalPreferenceCount: number;
  coveredCount: number;
  failedCount: number;
  expiredCount: number;
  skippedForBudget: number;
  usageObserved: number;
}

const MAXIMUM_PENDING_OWNER_RULES = 16;

/**
 * Rules stored but not applied yet, so a second phrasing of the same rule is judged `covered`
 * instead of becoming a duplicate candidate. Normalized text only, never turns.
 */
async function pendingOwnerRules(
  root: string,
): Promise<Array<{ title: string; statement: string }>> {
  const candidates = await listDurableInstructionCandidates(root).catch(() => []);
  return candidates
    .map((candidate) => ({
      title: candidate.instruction.title ?? candidate.ruleId,
      statement: candidate.instruction.statement ?? "",
    }))
    .slice(0, MAXIMUM_PENDING_OWNER_RULES);
}

/**
 * The ADR-0467 capture stage of the knowledge resident. It drains the transient owner-turn queue
 * under the hourly, daily, and per-cycle budget, assesses each turn semantically through the
 * governed provider path, and turns the result into a cross-checked rule candidate that the
 * resident applies (ADR-0561), a held item that is Lervo's own debt, or nothing. Queue text is
 * deleted as soon as a turn is settled.
 */
export async function runInstructionCaptureCycle(
  context: InstructionCaptureContext,
): Promise<InstructionCaptureCycleResult> {
  const storage = context.storage;
  const root = storage.paths.repositoryRoot;
  if ((storage.writableEventSchemaVersion ?? 1) < INSTRUCTION_CAPTURE_EVENT_SCHEMA_VERSION)
    return { status: "unavailable" };
  const now = context.now();
  const counts: CycleCounts = {
    assessedCount: 0,
    instructionCandidateCount: 0,
    decisionCount: 0,
    ignoredCount: 0,
    personalPreferenceCount: 0,
    coveredCount: 0,
    failedCount: 0,
    expiredCount: await pruneInstructionCaptureQueue(root, now),
    skippedForBudget: 0,
    usageObserved: 0,
  };
  const queue = await listQueuedInstructionCaptures(root);
  if (queue.length === 0 && counts.expiredCount === 0) return { status: "idle" };
  const state = await readInstructionCaptureState(root);
  state.budget = currentCaptureBudget(state, now);
  const assessed = new Set(state.assessed.map((entry) => entry.captureId));
  let catalog: DurableInstructionCatalogInspection | null = null;
  let deferred: string | null = null;
  let attempted = 0;
  for (const capture of queue) {
    if (assessed.has(capture.captureId)) {
      await removeQueuedInstructionCapture(root, capture.captureId);
      continue;
    }
    if (capture.nextAttemptAt !== undefined && Date.parse(capture.nextAttemptAt) > now.getTime())
      continue;
    if (attempted >= MAXIMUM_ASSESSMENTS_PER_CYCLE || !captureBudgetAvailable(state.budget)) {
      counts.skippedForBudget += 1;
      continue;
    }
    if (deferred !== null) break;
    catalog ??= inspectDurableInstructionCatalog(await scanConfiguredRepositoryKnowledge(root));
    attempted += 1;
    const practice = await preparePracticeCapture(context, capture).catch(() => null);
    const call = await assessInstructionCapture({
      context,
      captureId: capture.captureId,
      ...(practice?.validateDisclosure === undefined
        ? {}
        : { validatePrecedingWork: practice.validateDisclosure }),
      request: {
        ...(practice === null ? {} : { precedingWork: practice.data }),
        surface: capture.source,
        ownerTurn: capture.ownerTurn,
        precedingAgentTurn: capture.precedingAgentTurn,
        semanticCatalog: {
          ...catalog.semanticCatalog,
          pendingOwnerRules: await pendingOwnerRules(root),
        },
      },
      catalogEntries: catalog.semanticCatalog.canonicalInstructions.entries,
      sourceRevision: catalog.sourceSnapshotId,
    });
    if (call.status === "deferred") {
      if (practice !== null && call.attempted !== true)
        await releaseUnattemptedPracticeBudget(practice.reservation).catch(() => {});
      deferred = call.reason;
      break;
    }
    state.budget.assessmentsThisHour += 1;
    state.budget.assessmentsToday += 1;
    let outcome: Awaited<ReturnType<typeof settleInstructionCapture>> | null = null;
    if (call.status === "assessed") {
      if (practice !== null)
        await completePracticeCapture(context, practice, call.value, call.usage).catch(() => {});
      const addedPracticeTokens =
        practice === null || call.usage === null
          ? 0
          : Math.min(
              call.usage.totalTokens,
              Buffer.byteLength(JSON.stringify(practice.data)) +
                Buffer.byteLength(
                  JSON.stringify((call.value as { practice?: unknown } | null)?.practice ?? null),
                ),
            );
      const tokens = (call.usage?.totalTokens ?? 0) - addedPracticeTokens;
      state.budget.tokensToday += tokens;
      counts.usageObserved += tokens;
      try {
        outcome = await settleInstructionCapture({
          context: { ...context, provider: call.provider },
          capture,
          assessment: parseInstructionCaptureAssessment(call.value),
          catalog,
          state,
          now,
        });
      } catch (error) {
        // The same rule is already stored under another capture of the same words.
        if ((error as { code?: unknown }).code === "knowledge_plan_stale") outcome = "covered";
        // An invalid assessment or a refused candidate is a failed attempt, never a guess.
        else if (!(error instanceof TypeError) && (error as { code?: unknown }).code === undefined)
          throw error;
      }
    }
    if (typeof outcome === "object" && outcome !== null) {
      // The cross-check could not run now; the turn stays queued for a later cycle.
      deferred = outcome.deferred;
      break;
    }
    if (outcome === null || outcome === "retry") {
      const next = await recordInstructionCaptureAttempt(root, capture, now);
      // A retained owner rule is never dropped; it waits for its backoff instead.
      if (next.retained === true || next.attempts < MAXIMUM_ATTEMPTS) continue;
      counts.failedCount += 1;
    } else {
      counts.assessedCount += 1;
      if (outcome === "instruction_candidate") counts.instructionCandidateCount += 1;
      else if (outcome === "held") counts.decisionCount += 1;
      else if (outcome === "personal_preference") counts.personalPreferenceCount += 1;
      else if (outcome === "covered") counts.coveredCount += 1;
      else if (outcome === "ignored") counts.ignoredCount += 1;
    }
    state.assessed.push({ captureId: capture.captureId, at: now.toISOString() });
    await removeQueuedInstructionCapture(root, capture.captureId);
  }
  state.lastCycleAt = now.toISOString();
  // One attention record, not silent holding, when this host may not spend on assessment.
  const remaining = queue.length - counts.assessedCount - counts.failedCount;
  state.authorityBlocked =
    deferred === "knowledge_authority_unavailable" && remaining > 0
      ? {
          since: state.authorityBlocked?.since ?? now.toISOString(),
          queuedCount: remaining,
        }
      : null;
  await writeInstructionCaptureState(root, state, now);
  const cycleId = stableId("kccy", {
    at: now.toISOString(),
    queue: queue.map((capture) => capture.captureId),
  });
  if (counts.assessedCount + counts.failedCount + counts.expiredCount > 0)
    appendInstructionCaptureEvent({
      storage,
      type: "knowledge.instruction_capture.cycle.completed",
      correlationId: cycleId,
      occurredAt: now.toISOString(),
      payload: { cycleId, ...counts, occurredAt: now.toISOString() },
    });
  return {
    status: "completed",
    cycleId,
    assessedCount: counts.assessedCount,
    instructionCandidateCount: counts.instructionCandidateCount,
    decisionCount: counts.decisionCount,
    deferred,
  };
}
