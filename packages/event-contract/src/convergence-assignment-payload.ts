import { knowledgeConvergenceStages, type EventType } from "@lervo/schemas";

export const convergenceAssignmentPayloadFields = [
  "convergenceContractVersion",
  "convergenceObligationId",
  "convergenceBaselineEventId",
  "convergenceBaselineEventHash",
  "convergenceStage",
  "convergenceInputArtifactHash",
  "convergenceDelegationHash",
  "convergenceAgentId",
] as const;

export function validateConvergenceAssignmentPayload(
  type: EventType,
  payload: Record<string, unknown>,
): void {
  if (
    type !== "assignment.created" ||
    !convergenceAssignmentPayloadFields.some((field) => Object.hasOwn(payload, field))
  )
    return;
  const matches = (field: string, pattern: RegExp) =>
    typeof payload[field] === "string" && pattern.test(payload[field]);
  const hash = /^sha256:[a-f0-9]{64}$/u;
  if (
    payload.convergenceContractVersion !== 1 ||
    !matches("convergenceObligationId", /^kconv_[a-f0-9]{24}$/u) ||
    !matches("convergenceBaselineEventId", /^evt_[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/u) ||
    !matches("convergenceBaselineEventHash", hash) ||
    !matches("convergenceInputArtifactHash", hash) ||
    !matches("convergenceDelegationHash", hash) ||
    !matches("convergenceAgentId", /^agt_[a-f0-9]{24}$/u) ||
    !knowledgeConvergenceStages.some((stage) => stage === payload.convergenceStage)
  )
    throw new TypeError("The convergence assignment provenance is invalid.");
}
