import type {
  OperatingActionPlanV1,
  OwnerReasoningDecisionV1,
  SupervisedOwnerAttentionV1,
} from "@lervo/application-contract";
import { canonicalJson } from "@lervo/event-contract";
import type { ArtifactStore } from "@lervo/storage-contract";
import { supervisedOwnerAttentionFields } from "@lervo/work-controller";

export function nativeOwnerAttention(
  base: OperatingActionPlanV1,
  reasonCode: string,
  rationaleArtifactHash: string,
) {
  const effect: SupervisedOwnerAttentionV1 = {
    schemaVersion: 1,
    kind: "work.owner_attention",
    basisHash: base.responsibilityArtifactHash,
    reasonCode,
    rationaleArtifactHash,
    deadline: base.deadline,
  };
  return {
    effect,
    fields: supervisedOwnerAttentionFields(effect, base.roleId, base.provider),
    rationaleArtifactHash,
  };
}

/** A malformed model proposal becomes one bounded local decision need, not a repeated cycle error. */
export async function invalidNativeOwnerProposal(input: {
  artifacts: ArtifactStore;
  base: OperatingActionPlanV1;
  decision: OwnerReasoningDecisionV1;
  reasoningPlanHash: string;
  resultArtifactHash: string;
}) {
  const rationaleArtifactHash = (
    await input.artifacts.put(
      canonicalJson(
        `The ${input.decision.operation} proposal has invalid detail fields. Inspect reasoning plan ${input.reasoningPlanHash} and exact result ${input.resultArtifactHash} before revising its bounded effect.`,
      ),
    )
  ).contentHash;
  return nativeOwnerAttention(input.base, "owner_proposal_invalid", rationaleArtifactHash);
}
