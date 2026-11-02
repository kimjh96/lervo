import {
  canonicalJson,
  createDurableInstructionCandidate,
  createDurableInstructionPlan,
  durableInstructionCatalogDigest,
  instructionCaptureRoute,
  sha256,
  storeDurableInstructionCandidate,
  type DurableInstructionCatalogInspection,
  type InstructionCaptureAssessment,
} from "@lervo/repository-knowledge";
import type { InstructionCaptureContext } from "./instruction-capture-assessment.js";
import { crossCheckCapturedInstruction } from "./instruction-capture-cross-check.js";
import { appendInstructionCaptureEvent } from "./instruction-capture-events.js";
import type { QueuedInstructionCapture } from "./instruction-capture-queue.js";
import type { HeldCapture, InstructionCaptureState } from "./instruction-capture-state.js";

/**
 * `rejected`: the independent cross-check disagreed, so the rule was not stored and is recorded
 * as Lervo's own debt. `retry`: the rule text or the cross-check verdict was unusable and the turn
 * is attempted again. `deferred`: the cross-check could not run now; the turn stays queued.
 */
type CaptureOutcome =
  | "instruction_candidate"
  | "held"
  | "ignored"
  | "personal_preference"
  | "covered"
  | "rejected"
  | "retry"
  | { deferred: string };

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
    instruction: assessment.durableInstruction,
  });
  if (plan.status === "current" || assessment.durableInstruction.conflict === "covered")
    return "covered";
  if (plan.status === "ungrounded") return "retry";
  if (plan.status !== "ready") return "ignored";
  const check = await crossCheckCapturedInstruction({
    context: input.context,
    capture,
    instruction: assessment.durableInstruction,
    catalogEntries: catalog.semanticCatalog.canonicalInstructions.entries,
    sourceRevision: catalog.sourceSnapshotId,
  });
  if (check.status === "deferred") return { deferred: check.reason };
  if (check.status === "failed") return "retry";
  if (check.status === "agree" || check.status === "disagree")
    input.state.budget.tokensToday += check.tokens;
  if (check.status === "disagree") {
    const { title, statement } = assessment.durableInstruction;
    input.state.held.push(
      held({
        capture,
        kind: "cross_check_disagreement",
        title: title!,
        statement: statement!,
        subjectKey: null,
        now: input.now,
      }),
    );
    return "rejected";
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

export async function settleInstructionCapture(input: {
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
