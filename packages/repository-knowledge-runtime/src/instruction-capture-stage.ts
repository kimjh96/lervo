import {
  canonicalJson,
  createDurableInstructionCandidate,
  createDurableInstructionPlan,
  durableInstructionCatalogDigest,
  inspectDurableInstructionCatalog,
  listDurableInstructionCandidates,
  instructionCaptureRoute,
  parseInstructionCaptureAssessment,
  scanConfiguredRepositoryKnowledge,
  sha256,
  stableId,
  storeDurableInstructionCandidate,
  type DurableInstructionCatalogInspection,
  type InstructionCaptureAssessment,
} from "@lervo/repository-knowledge";

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
  type QueuedInstructionCapture,
} from "./instruction-capture-queue.js";
import {
  captureBudgetAvailable,
  currentCaptureBudget,
  MAXIMUM_ASSESSMENTS_PER_CYCLE,
  readInstructionCaptureState,
  writeInstructionCaptureState,
  type HeldCapture,
  type InstructionCaptureState,
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

type CaptureOutcome =
  "instruction_candidate" | "held" | "ignored" | "personal_preference" | "covered";

function held(input: {
  capture: QueuedInstructionCapture;
  kind: HeldCapture["kind"];
  title: string;
  statement: string;
  subjectKey: string | null;
  now: Date;
}): HeldCapture {
  return {
    captureId: input.capture.captureId,
    kind: input.kind,
    source: input.capture.source,
    title: input.title,
    statement: input.statement,
    subjectKey: input.subjectKey,
    summaryHash: sha256(
      canonicalJson({
        title: input.title,
        statement: input.statement,
        subjectKey: input.subjectKey,
      }),
    ),
    capturedAt: input.now.toISOString(),
  };
}

/** Records the ADR-0457 conversation event for a candidate that came from a managed conversation. */
function recordConversationCandidate(input: {
  context: InstructionCaptureContext;
  capture: QueuedInstructionCapture;
  kind: "decision" | "instruction";
  subjectKey: string;
  summaryHash: string;
  candidateId: string;
  occurredAt: string;
}): void {
  if (input.capture.source !== "conversation" || input.capture.conversation === null) return;
  appendInstructionCaptureEvent({
    storage: input.context.storage,
    type: "conversation.knowledge_candidate.recorded",
    correlationId: `${input.capture.captureId}\0${input.candidateId}`,
    occurredAt: input.occurredAt,
    payload: {
      conversationEventId: input.capture.conversation.conversationEventId,
      agentId: input.capture.conversation.agentId,
      kind: input.kind,
      subjectKeyDigest: sha256(input.subjectKey),
      summaryHash: input.summaryHash,
      candidateId: input.candidateId,
      occurredAt: input.occurredAt,
    },
  });
}

async function materializeInstruction(input: {
  context: InstructionCaptureContext;
  capture: QueuedInstructionCapture;
  assessment: InstructionCaptureAssessment;
  catalog: DurableInstructionCatalogInspection;
  state: InstructionCaptureState;
  now: Date;
}): Promise<CaptureOutcome> {
  const { assessment, capture, catalog } = input;
  const root = input.context.storage.paths.repositoryRoot;
  const plan = await createDurableInstructionPlan({
    repositoryRoot: root,
    projectId: input.context.storage.manifest.projectId,
    requestDigest: capture.promptDigest,
    resolverResultDigest: sha256(canonicalJson(assessment)),
    groundingStatus: "ready",
    catalogComplete:
      catalog.complete && catalog.semanticCatalog.canonicalInstructions.entries.length < 32,
    ambiguityReasons: [],
    instruction: assessment.durableInstruction,
  });
  if (plan.status === "current" || assessment.durableInstruction.conflict === "covered")
    return "covered";
  if (plan.status !== "ready") {
    const { title, statement } = assessment.durableInstruction;
    if (plan.status === "pending" && title !== null && statement !== null) {
      input.state.held.push(
        held({
          capture,
          kind: "rule_needs_clarification",
          title,
          statement,
          subjectKey: null,
          now: input.now,
        }),
      );
      return "held";
    }
    return "ignored";
  }
  const candidate = await storeDurableInstructionCandidate({
    repositoryRoot: root,
    candidate: createDurableInstructionCandidate({
      plan,
      provider: input.context.provider,
      sourceSnapshotId: catalog.sourceSnapshotId,
      instruction: assessment.durableInstruction,
      now: input.now,
      instructionCatalogDigest: durableInstructionCatalogDigest(
        catalog.semanticCatalog.canonicalInstructions.entries,
      ),
      capture: { source: capture.source, captureId: capture.captureId },
    }),
  });
  const occurredAt = input.now.toISOString();
  appendInstructionCaptureEvent({
    storage: input.context.storage,
    type: "knowledge.instruction_candidate.captured",
    correlationId: `${capture.captureId}\0${candidate.candidateId}`,
    occurredAt,
    payload: {
      candidateId: candidate.candidateId,
      captureId: capture.captureId,
      source: capture.source,
      // `instructionCaptureRoute` sends only rule, correction, and rule-shaped decision classes here.
      captureClass: assessment.captureClass,
      turnDigest: capture.promptDigest,
      occurredAt,
    },
  });
  recordConversationCandidate({
    context: input.context,
    capture,
    kind: "instruction",
    subjectKey: candidate.ruleId,
    summaryHash: candidate.proposedContentHash,
    candidateId: candidate.candidateId,
    occurredAt,
  });
  return "instruction_candidate";
}

async function settle(input: {
  context: InstructionCaptureContext;
  capture: QueuedInstructionCapture;
  assessment: InstructionCaptureAssessment;
  catalog: DurableInstructionCatalogInspection;
  state: InstructionCaptureState;
  now: Date;
}): Promise<CaptureOutcome> {
  const route = instructionCaptureRoute(input.assessment);
  if (route === "ignored") return "ignored";
  if (route === "personal_preference") return "personal_preference";
  if (route === "instruction") return materializeInstruction(input);
  const decision = input.assessment.decision!;
  const entry = held({
    capture: input.capture,
    kind: "decision",
    title: decision.title,
    statement: decision.statement,
    subjectKey: decision.subjectKey,
    now: input.now,
  });
  input.state.held.push(entry);
  recordConversationCandidate({
    context: input.context,
    capture: input.capture,
    kind: "decision",
    subjectKey: decision.subjectKey,
    summaryHash: entry.summaryHash,
    candidateId: input.capture.captureId,
    occurredAt: input.now.toISOString(),
  });
  return "held";
}

const MAXIMUM_PENDING_OWNER_RULES = 16;

/**
 * Rules that already wait for the owner, so a second phrasing of the same rule is judged
 * `covered` instead of becoming a duplicate candidate. Normalized text only, never turns.
 */
async function pendingOwnerRules(
  root: string,
  state: InstructionCaptureState,
): Promise<Array<{ title: string; statement: string }>> {
  const candidates = await listDurableInstructionCandidates(root).catch(() => []);
  return [
    ...candidates.map((candidate) => ({
      title: candidate.instruction.title ?? candidate.ruleId,
      statement: candidate.instruction.statement ?? "",
    })),
    ...state.held
      .filter((entry) => entry.kind === "rule_needs_clarification")
      .map((entry) => ({ title: entry.title, statement: entry.statement })),
  ].slice(0, MAXIMUM_PENDING_OWNER_RULES);
}

/**
 * The ADR-0466 capture stage of the knowledge resident. It drains the transient owner-turn queue
 * under the hourly, daily, and per-cycle budget, assesses each turn semantically through the
 * governed provider path, and turns the result into an exact-review candidate, a held decision or
 * clarification for the owner, or nothing. Queue text is deleted as soon as a turn is settled.
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
    if (attempted >= MAXIMUM_ASSESSMENTS_PER_CYCLE || !captureBudgetAvailable(state.budget)) {
      counts.skippedForBudget += 1;
      continue;
    }
    if (deferred !== null) break;
    catalog ??= inspectDurableInstructionCatalog(await scanConfiguredRepositoryKnowledge(root));
    attempted += 1;
    const call = await assessInstructionCapture({
      context,
      captureId: capture.captureId,
      request: {
        surface: capture.source,
        ownerTurn: capture.ownerTurn,
        precedingAgentTurn: capture.precedingAgentTurn,
        semanticCatalog: {
          ...catalog.semanticCatalog,
          pendingOwnerRules: await pendingOwnerRules(root, state),
        },
      },
      catalogEntries: catalog.semanticCatalog.canonicalInstructions.entries,
      sourceRevision: catalog.sourceSnapshotId,
    });
    if (call.status === "deferred") {
      deferred = call.reason;
      break;
    }
    state.budget.assessmentsThisHour += 1;
    state.budget.assessmentsToday += 1;
    let outcome: CaptureOutcome | null = null;
    if (call.status === "assessed") {
      const tokens = call.usage?.totalTokens ?? 0;
      state.budget.tokensToday += tokens;
      counts.usageObserved += tokens;
      try {
        outcome = await settle({
          context,
          capture,
          assessment: parseInstructionCaptureAssessment(call.value),
          catalog,
          state,
          now,
        });
      } catch (error) {
        // The same rule already waits for review under another capture of the same words.
        if ((error as { code?: unknown }).code === "knowledge_plan_stale") outcome = "covered";
        // An invalid assessment or a refused candidate is a failed attempt, never a guess.
        else if (!(error instanceof TypeError) && (error as { code?: unknown }).code === undefined)
          throw error;
      }
    }
    if (outcome === null) {
      const next = await recordInstructionCaptureAttempt(root, capture);
      if (next.attempts < MAXIMUM_ATTEMPTS) continue;
      counts.failedCount += 1;
    } else {
      counts.assessedCount += 1;
      if (outcome === "instruction_candidate") counts.instructionCandidateCount += 1;
      else if (outcome === "held") counts.decisionCount += 1;
      else if (outcome === "personal_preference") counts.personalPreferenceCount += 1;
      else if (outcome === "covered") counts.coveredCount += 1;
      else counts.ignoredCount += 1;
    }
    state.assessed.push({ captureId: capture.captureId, at: now.toISOString() });
    await removeQueuedInstructionCapture(root, capture.captureId);
  }
  state.lastCycleAt = now.toISOString();
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
