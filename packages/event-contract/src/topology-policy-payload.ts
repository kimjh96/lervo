import type { EventType } from "@lervo/schemas";

export function validateTopologyPolicyPayload(
  type: EventType,
  payload: Record<string, unknown>,
): void {
  if (type !== "assignment.created") return;
  const keys = [
    "topologyPolicyReviewVersion",
    "topologyPolicyDecisionId",
    "topologyPolicyReviewHash",
  ];
  if (!keys.some((key) => Object.hasOwn(payload, key))) return;
  if (
    !keys.every((key) => Object.hasOwn(payload, key)) ||
    payload.topologyContractVersion !== 2 ||
    payload.topologyPolicyReviewVersion !== 1 ||
    typeof payload.topologyPolicyDecisionId !== "string" ||
    !/^osd_[a-f0-9]{24}$/u.test(payload.topologyPolicyDecisionId) ||
    typeof payload.topologyPolicyReviewHash !== "string" ||
    !/^sha256:[a-f0-9]{64}$/u.test(payload.topologyPolicyReviewHash)
  )
    throw new TypeError("The automatic topology policy evidence is invalid.");
}
