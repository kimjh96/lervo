import type { FromSchema } from "json-schema-to-ts";

import { conversationEventIdSchema, sha256Schema, timestampSchema } from "./common.js";

/**
 * ADR-0457 and ADR-0466 owner-turn capture events. Payloads carry identifiers, digests, classes,
 * and counts only. Owner turns, preceding agent turns, provider output, rule text, and decision
 * summaries never enter an event; normalized summaries live in CAS or the candidate store and the
 * event binds them by hash. `usageObserved` is the provider-reported total token count.
 */
const instructionCandidateIdSchema = {
  type: "string",
  pattern: "^kinstruction_[a-f0-9]{24}$",
} as const;
const captureIdSchema = { type: "string", pattern: "^kcap_[a-f0-9]{24}$" } as const;
const captureCycleIdSchema = { type: "string", pattern: "^kccy_[a-f0-9]{24}$" } as const;
const countSchema = { type: "integer", minimum: 0, maximum: 1_000_000 } as const;

export const instructionCaptureSources = ["terminal_prompt", "conversation"] as const;
export const instructionCaptureCandidateClasses = [
  "durable_instruction",
  "correction_of_agent_behavior",
  "decision",
] as const;

export const knowledgeInstructionCandidateCapturedEventPayloadSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://schemas.lervo.dev/v0/knowledge-instruction-candidate-captured-event-payload.schema.json",
  type: "object",
  properties: {
    candidateId: instructionCandidateIdSchema,
    captureId: captureIdSchema,
    source: { type: "string", enum: instructionCaptureSources },
    captureClass: { type: "string", enum: instructionCaptureCandidateClasses },
    turnDigest: sha256Schema,
    occurredAt: timestampSchema,
  },
  required: ["candidateId", "captureId", "source", "captureClass", "turnDigest", "occurredAt"],
  additionalProperties: false,
} as const;

export const conversationKnowledgeCandidateRecordedEventPayloadSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://schemas.lervo.dev/v0/conversation-knowledge-candidate-recorded-event-payload.schema.json",
  type: "object",
  properties: {
    conversationEventId: conversationEventIdSchema,
    agentId: { anyOf: [{ type: "string", pattern: "^agt_[a-f0-9]{24}$" }, { type: "null" }] },
    kind: { type: "string", enum: ["decision", "instruction", "fact"] },
    subjectKeyDigest: sha256Schema,
    summaryHash: sha256Schema,
    candidateId: { anyOf: [instructionCandidateIdSchema, captureIdSchema] },
    occurredAt: timestampSchema,
  },
  required: [
    "conversationEventId",
    "agentId",
    "kind",
    "subjectKeyDigest",
    "summaryHash",
    "candidateId",
    "occurredAt",
  ],
  additionalProperties: false,
} as const;

export const knowledgeInstructionCaptureCycleCompletedEventPayloadSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://schemas.lervo.dev/v0/knowledge-instruction-capture-cycle-completed-event-payload.schema.json",
  type: "object",
  properties: {
    cycleId: captureCycleIdSchema,
    assessedCount: countSchema,
    instructionCandidateCount: countSchema,
    decisionCount: countSchema,
    ignoredCount: countSchema,
    personalPreferenceCount: countSchema,
    coveredCount: countSchema,
    failedCount: countSchema,
    expiredCount: countSchema,
    skippedForBudget: countSchema,
    usageObserved: countSchema,
    occurredAt: timestampSchema,
  },
  required: [
    "cycleId",
    "assessedCount",
    "instructionCandidateCount",
    "decisionCount",
    "ignoredCount",
    "personalPreferenceCount",
    "coveredCount",
    "failedCount",
    "expiredCount",
    "skippedForBudget",
    "usageObserved",
    "occurredAt",
  ],
  additionalProperties: false,
} as const;

export type KnowledgeInstructionCandidateCapturedEventPayload = FromSchema<
  typeof knowledgeInstructionCandidateCapturedEventPayloadSchema
>;
export type ConversationKnowledgeCandidateRecordedEventPayload = FromSchema<
  typeof conversationKnowledgeCandidateRecordedEventPayloadSchema
>;
export type KnowledgeInstructionCaptureCycleCompletedEventPayload = FromSchema<
  typeof knowledgeInstructionCaptureCycleCompletedEventPayloadSchema
>;

export const instructionCaptureEventTypes = [
  "knowledge.instruction_candidate.captured",
  "conversation.knowledge_candidate.recorded",
  "knowledge.instruction_capture.cycle.completed",
] as const;
