import type {
  OperatingActionPlanV1,
  ScopedWorkHandoffV1,
  ScopedWorkHandoffAcceptanceV1,
  ScopedWorkHandoffRequestV1,
} from "@lervo/application-contract";
import type { ArtifactStore } from "@lervo/storage-contract";
import {
  assertScopedHandoffRequest,
  operatingContractHash,
  scopedHandoffFields,
} from "@lervo/work-controller";
import { readSupervisionJsonArtifact } from "./supervision-artifact-json.js";

/** Immutable scope only; current repository and peer authority are separate admission checks. */
export async function readSupervisionHandoffArtifact(
  artifacts: ArtifactStore,
  plan: OperatingActionPlanV1,
) {
  const effect = (await readSupervisionJsonArtifact(artifacts, plan.effectHash)) as
    ScopedWorkHandoffV1 | ScopedWorkHandoffAcceptanceV1;
  if (!["work.scoped_handoff", "work.scoped_handoff_acceptance"].includes(effect?.kind))
    throw new Error("The scoped handoff effect kind is invalid.");
  const offer =
    effect.kind === "work.scoped_handoff"
      ? effect
      : ((await readSupervisionJsonArtifact(artifacts, effect.handoffHash)) as ScopedWorkHandoffV1);
  const fields = scopedHandoffFields(effect, plan.roleId, plan.provider, plan.deadline, offer);
  if (
    Object.entries(fields).some(
      ([key, value]) =>
        operatingContractHash(value) !==
        operatingContractHash(plan[key as keyof OperatingActionPlanV1]),
    )
  )
    throw new Error("The scoped handoff plan differs from its exact effect.");
  const request = (await readSupervisionJsonArtifact(
    artifacts,
    offer.requestArtifactHash,
  )) as ScopedWorkHandoffRequestV1;
  assertScopedHandoffRequest(request, offer);
  const rationale = await readSupervisionJsonArtifact(artifacts, effect.rationaleArtifactHash);
  if (typeof rationale !== "string" || !rationale.trim())
    throw new Error("The scoped handoff requires an exact nonempty rationale.");
  return { effect, offer, request, fields };
}
