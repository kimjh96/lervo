import type { OperatingActionPlanV1 } from "@lervo/application-contract";
import type { ProjectStorage } from "@lervo/project-storage";
import { operatingDecisionId } from "@lervo/work-controller";
import {
  assertSupervisionAdmissionAuthorityStable,
  finalizeSupervisionAdmission,
} from "./supervision-admission-finalization.js";
import {
  observeNodeSupervisionAuthority,
  type NodeSupervisionBinding,
} from "./supervision-authority.js";
import type { SupervisionAuthorityHistory } from "./supervision-authority-history.js";
import { observeSupervisionTaskAdmission } from "./supervision-task-admission.js";
import type { SupervisionTaskSource } from "./supervision-task-source.js";

/** Completes the admission's source and authority recheck before dating its evidence. */
export async function readSupervisionTaskAdmission(input: {
  storage: ProjectStorage;
  binding: NodeSupervisionBinding;
  history: SupervisionAuthorityHistory;
  readSource: SupervisionTaskSource["read"];
  plan: OperatingActionPlanV1;
  now: () => string;
}) {
  const decisionId = operatingDecisionId(input.plan);
  const source = await input.readSource(decisionId);
  const authority = await observeNodeSupervisionAuthority(
    input.storage,
    input.binding,
    input.now,
    input.history,
  );
  const observation = await observeSupervisionTaskAdmission({
    storage: input.storage,
    repositoryRoot: input.storage.paths.repositoryRoot,
    source,
    authority,
    plan: input.plan,
    artifacts: input.storage.artifacts,
    events: input.storage.events,
    binding: input.binding,
    now: input.now(),
  });
  const current = await input.readSource(decisionId);
  if (current.sourceRevisionDigest !== source.sourceRevisionDigest)
    throw new Error("The supervision admission changed during observation.");
  const observedAt = input.now();
  const currentAuthority = await observeNodeSupervisionAuthority(
    input.storage,
    input.binding,
    input.now,
    input.history,
  );
  assertSupervisionAdmissionAuthorityStable(authority, currentAuthority);
  return finalizeSupervisionAdmission({
    observation,
    source: current,
    responsibilityArtifactHash: input.plan.responsibilityArtifactHash,
    observedAt,
  });
}
