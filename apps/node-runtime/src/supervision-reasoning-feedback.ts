import type { EventEnvelope } from "@lervo/schemas";
import { managedExecutionIdentity } from "@lervo/work-controller";

export interface OwnerProposalFeedback {
  reasonCode: "invalid_expected_path" | "invalid_task_contract" | "invalid_reasoning_result";
  reasoningPlanHash: string;
  resultArtifactHash: string;
}

/** A retry hint is private, exact prior-run evidence rather than a new authority source. */
export function assertOwnerProposalFeedback(input: {
  feedback: unknown;
  events: readonly EventEnvelope[];
  projectId: string;
  supervisionId: string;
  workstreamId: string;
}): asserts input is typeof input & { feedback: OwnerProposalFeedback } {
  const feedback = input.feedback;
  if (
    feedback === null ||
    typeof feedback !== "object" ||
    Array.isArray(feedback) ||
    Object.keys(feedback).length !== 3 ||
    !Object.hasOwn(feedback, "reasonCode") ||
    !Object.hasOwn(feedback, "reasoningPlanHash") ||
    !Object.hasOwn(feedback, "resultArtifactHash")
  )
    throw new Error("The owner proposal feedback is invalid.");
  const value = feedback as Record<string, unknown>;
  if (
    typeof value.reasonCode !== "string" ||
    !["invalid_expected_path", "invalid_task_contract", "invalid_reasoning_result"].includes(
      value.reasonCode,
    ) ||
    typeof value.reasoningPlanHash !== "string" ||
    !/^sha256:[a-f0-9]{64}$/u.test(value.reasoningPlanHash) ||
    typeof value.resultArtifactHash !== "string" ||
    !/^sha256:[a-f0-9]{64}$/u.test(value.resultArtifactHash)
  )
    throw new Error("The owner proposal feedback is invalid.");
  const identity = managedExecutionIdentity(input.projectId, value.reasoningPlanHash);
  if (
    !input.events.some(
      (event) =>
        event.type === "work.supervision.decision.recorded" &&
        event.payload.planHash === value.reasoningPlanHash &&
        event.payload.supervisionId === input.supervisionId &&
        event.payload.workstreamId === input.workstreamId,
    ) ||
    !input.events.some(
      (event) =>
        event.type === "run.completed" &&
        event.runId === identity.runId &&
        event.payload.resultDigest === value.resultArtifactHash,
    )
  )
    throw new Error("The owner proposal feedback lacks exact completed reasoning evidence.");
}
