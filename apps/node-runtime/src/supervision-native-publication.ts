import type { SupervisedResultDeliveryV2 } from "@lervo/application-contract";
import { createVerifiedConversationControlReply } from "@lervo/conversation-control";
import {
  assertConversationOutboundMessage,
  calculateConversationOutboundId,
} from "@lervo/conversation-contract";
import { canonicalJson } from "@lervo/event-contract";
import { supervisedResultDeliveryFields } from "@lervo/work-controller";
import type { SemanticWritingEvaluationResponse } from "@lervo/writing";
import type { NativeOwnerPlanInput } from "./supervision-native-plans.js";

/** Freezes the accepted result only after an independently managed contextual writing judgement. */
export async function nativeResultPublication(
  input: NativeOwnerPlanInput,
  details: Record<string, unknown>,
  rationaleArtifactHash: string,
) {
  const accepted = input.facts.acceptedGoal;
  const policy = input.facts.resultWritingContract;
  const origin = input.publicationOrigin;
  if (
    origin === undefined ||
    accepted === null ||
    Object.keys(details).sort().join(",") !== "checks,resultContentHash,writingPolicyId" ||
    details.resultContentHash !== accepted.resultArtifactHash ||
    details.writingPolicyId !== policy.writingPolicyId ||
    !Array.isArray(details.checks) ||
    details.checks.length !==
      policy.verification.semanticChecks.filter((item) => item.required).length ||
    [...accepted.text].length > 2000
  )
    throw new Error(
      "The native publication differs from the accepted result, origin or writing policy.",
    );
  const checks = details.checks as SemanticWritingEvaluationResponse["checks"];
  if (
    checks.some((check) => Object.keys(check).sort().join(",") !== "checkId,status,violationCount")
  )
    throw new Error("The native publication semantic check shape is invalid.");
  const candidate = await createVerifiedConversationControlReply({
    artifactStore: input.storage.artifacts,
    writingContract: policy,
    content: accepted.text,
    now: () => new Date(input.now()),
    semanticEvaluator: {
      evaluate: async (request) => {
        if (
          request.contentHash !== accepted.resultArtifactHash ||
          request.content !== accepted.text ||
          request.writingPolicyId !== policy.writingPolicyId
        )
          throw new Error("The semantic publication request differs from its native judgement.");
        return {
          evaluator: {
            kind: "model",
            evaluatorId: `lervo.native-owner.${input.resultArtifactHash.slice(7, 31)}`,
          },
          checks,
        };
      },
    },
  });
  const content = {
    schemaVersion: 1 as const,
    ...structuredClone(origin),
    content: candidate.content,
    publicationPermit: candidate.publicationPermit,
    deliveryRelation: (input.facts.boundRequest?.source === "discord" ? "reply" : "standalone") as
      "reply" | "standalone",
    automationDepth: 1,
    createdAt: input.now(),
  };
  const outbound = { ...content, outboundId: calculateConversationOutboundId(content) };
  assertConversationOutboundMessage({ outbound });
  const effect: SupervisedResultDeliveryV2 = {
    schemaVersion: 2,
    kind: "work.result_delivery",
    workstreamId: input.base.workstreamId,
    ownerAgentId: input.base.ownerAgentId,
    completionPlanHash: accepted.completionPlanHash,
    completionEventId: accepted.completionEventId,
    resultArtifactHash: accepted.resultArtifactHash,
    candidateArtifactHash: (await input.storage.artifacts.put(canonicalJson(candidate)))
      .contentHash,
    outboundArtifactHash: (await input.storage.artifacts.put(canonicalJson(outbound))).contentHash,
    reasoningPlanHash: input.reasoningPlanHash,
    reasoningResultHash: input.resultArtifactHash,
    rationaleArtifactHash,
  };
  return { effect, fields: supervisedResultDeliveryFields(effect) };
}
