import type { SupervisedWorkerHireV1 } from "@lervo/application-contract";
import { canonicalJson } from "@lervo/event-contract";
import { operatingContractHash, supervisedWorkerHireFields } from "@lervo/work-controller";
import type { NativeOwnerPlanInput } from "./supervision-native-plans.js";
import { nativeTaskRequirement } from "./supervision-native-task.js";
import { prepareSupervisionWorkforcePlan } from "./supervision-workforce-planning.js";

export async function nativeWorkerHire(
  input: NativeOwnerPlanInput,
  details: Record<string, unknown>,
  rationaleArtifactHash: string,
) {
  if (
    Object.keys(details).sort().join(",") !== "displayName,task" ||
    typeof details.displayName !== "string" ||
    details.task === null ||
    typeof details.task !== "object" ||
    Array.isArray(details.task)
  )
    throw new Error("A native hire requires one named worker and an exact task requirement.");
  const { task } = nativeTaskRequirement(input, details.task as Record<string, unknown>);
  const provider = input.base.provider;
  if (provider !== "codex" && provider !== "claude")
    throw new Error("The native hire provider is unsupported.");
  const planning = await prepareSupervisionWorkforcePlan({
    repositoryRoot: input.storage.paths.repositoryRoot,
    projectId: input.base.projectId,
    workstreamId: input.base.workstreamId,
    workstreamRevision: input.facts.workstream.revision,
    ownerAgentId: input.base.ownerAgentId,
    provider,
    responsibility: task,
    configuration: input.readiness,
    now: input.now,
  });
  if (!["skill_gap", "capacity_gap"].includes(planning.selection.disposition))
    throw new Error(
      "The native hire has no observed staffing gap in a ready provider environment.",
    );
  const evidence = await input.storage.artifacts.put(canonicalJson(planning.evidence));
  const rationale = await input.storage.artifacts.put(
    canonicalJson(
      `Original judgement: ${rationaleArtifactHash}\nGrounded staffing alternatives: ${evidence.contentHash}\nHire one scoped child only; assignment and dispatch require separate admission.`,
    ),
  );
  const effect: SupervisedWorkerHireV1 = {
    schemaVersion: 1,
    kind: "work.worker_hire",
    requirement: task,
    displayName: details.displayName,
    provider,
    expectedAgentsHash: operatingContractHash(input.facts.agents),
    rationaleArtifactHash: rationale.contentHash,
  };
  return {
    effect,
    fields: supervisedWorkerHireFields(effect),
    rationaleArtifactHash: rationale.contentHash,
  };
}
