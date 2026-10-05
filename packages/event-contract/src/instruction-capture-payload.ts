/** ADR-0457 and ADR-0466 capture events: identifiers, digests, classes, and counts only. */
export const instructionCapturePayloadAllowlists = {
  "knowledge.instruction_candidate.captured": [
    "candidateId",
    "captureId",
    "source",
    "captureClass",
    "turnDigest",
    "occurredAt",
  ],
  "conversation.knowledge_candidate.recorded": [
    "conversationEventId",
    "agentId",
    "kind",
    "subjectKeyDigest",
    "summaryHash",
    "candidateId",
    "occurredAt",
  ],
  "knowledge.instruction_capture.cycle.completed": [
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
} as const;

export const instructionCapturePayloadSchemas = {
  "knowledge.instruction_candidate.captured": "knowledgeInstructionCandidateCapturedEventPayload",
  "conversation.knowledge_candidate.recorded": "conversationKnowledgeCandidateRecordedEventPayload",
  "knowledge.instruction_capture.cycle.completed":
    "knowledgeInstructionCaptureCycleCompletedEventPayload",
} as const;
