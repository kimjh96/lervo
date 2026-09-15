import type { AgentContextEventEnvelope } from "./agent-context-types.js";

const governedFields = [
  "memoryKind",
  "subjectKey",
  "audience",
  "sensitivity",
  "confidence",
  "retrievalDigests",
  "observedAt",
  "expiresAt",
  "reviewBindingVersion",
] as const;

export function hasGovernedAgentContextMetadata(payload: Record<string, unknown>): boolean {
  return governedFields.some((field) => Object.hasOwn(payload, field));
}

export function hasCompleteGovernedAgentContextMetadata(payload: Record<string, unknown>): boolean {
  return (
    payload.reviewBindingVersion === 2 &&
    governedFields.every((field) => Object.hasOwn(payload, field))
  );
}

/** Proves that a review or verified completion attests these exact summary bytes. */
export function agentContextReviewAttests(input: {
  review: AgentContextEventEnvelope;
  summaryContentHash: string;
  agentId: string;
}): boolean {
  const payload = input.review.payload as Record<string, unknown>;
  if (input.review.type === "conversation.repository_work.completed") {
    return (
      payload.workerAgentId === input.agentId &&
      payload.resultContentHash === input.summaryContentHash &&
      payload.verificationStatus === "passed"
    );
  }
  if (input.review.type === "knowledge.candidate.reviewed") {
    return (
      payload.decision === "approved" && payload.candidateContentHash === input.summaryContentHash
    );
  }
  if (input.review.type === "knowledge.reconciliation.reviewed") {
    return (
      payload.decision === "approved" && payload.candidateArtifactHash === input.summaryContentHash
    );
  }
  if (input.review.type === "knowledge.verified") {
    return payload.candidateContentHash === input.summaryContentHash;
  }
  return (
    input.review.type === "verification.completed" &&
    payload.status === "passed" &&
    payload.resultContentHash === input.summaryContentHash
  );
}
