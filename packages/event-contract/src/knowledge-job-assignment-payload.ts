import type { EventType } from "@lervo/schemas";

const fields = [
  "knowledgeJobContractVersion",
  "knowledgeJobId",
  "knowledgeCompletionEventId",
  "knowledgeCompletionEventHash",
  "knowledgeSourceConversationEventId",
  "knowledgeSourceManifestHash",
  "knowledgeAgentId",
] as const;

export function validateKnowledgeJobAssignmentPayload(
  type: EventType,
  payload: Record<string, unknown>,
): void {
  if (type !== "assignment.created" || !fields.some((field) => Object.hasOwn(payload, field)))
    return;
  if (
    !fields.every((field) => Object.hasOwn(payload, field)) ||
    payload.knowledgeJobContractVersion !== 1 ||
    typeof payload.knowledgeJobId !== "string" ||
    !/^kjb_[a-f0-9]{24}$/u.test(payload.knowledgeJobId) ||
    typeof payload.knowledgeCompletionEventId !== "string" ||
    !/^evt_[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/u.test(payload.knowledgeCompletionEventId) ||
    typeof payload.knowledgeCompletionEventHash !== "string" ||
    !/^sha256:[a-f0-9]{64}$/u.test(payload.knowledgeCompletionEventHash) ||
    typeof payload.knowledgeSourceConversationEventId !== "string" ||
    !/^cve_[a-f0-9]{64}$/u.test(payload.knowledgeSourceConversationEventId) ||
    (payload.knowledgeSourceManifestHash !== null &&
      (typeof payload.knowledgeSourceManifestHash !== "string" ||
        !/^sha256:[a-f0-9]{64}$/u.test(payload.knowledgeSourceManifestHash))) ||
    typeof payload.knowledgeAgentId !== "string" ||
    !/^agt_[a-f0-9]{24}$/u.test(payload.knowledgeAgentId)
  )
    throw new TypeError("The knowledge-job assignment provenance is invalid.");
}
