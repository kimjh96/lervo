import type {
  OperatingActionPlanV1,
  SupervisedOwnerAttentionV1,
} from "@lervo/application-contract";
import type { ArtifactStore } from "@lervo/storage-contract";
import { operatingContractHash, supervisedOwnerAttentionFields } from "@lervo/work-controller";
import { readSupervisionJsonArtifact } from "./supervision-artifact-json.js";

export async function readSupervisionAttentionArtifact(
  artifacts: ArtifactStore,
  plan: OperatingActionPlanV1,
) {
  const effect = (await readSupervisionJsonArtifact(
    artifacts,
    plan.effectHash,
  )) as SupervisedOwnerAttentionV1;
  const fields = supervisedOwnerAttentionFields(effect, plan.roleId, plan.provider);
  if (
    Object.entries(fields).some(
      ([key, value]) =>
        operatingContractHash(value) !==
        operatingContractHash(plan[key as keyof OperatingActionPlanV1]),
    )
  )
    throw new Error("The owner attention plan differs from its exact effect.");
  const rationale = await readSupervisionJsonArtifact(artifacts, effect.rationaleArtifactHash);
  if (typeof rationale !== "string" || !rationale.trim() || rationale.length > 32768)
    throw new Error("Owner attention requires bounded concrete decision context.");
  return { effect, fields };
}
