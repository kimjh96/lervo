import type { SupervisedAssignmentAmendmentV1 } from "@lervo/application-contract";
import { supervisedAssignmentAmendmentFields } from "@lervo/work-controller";
import type { SupervisedResponsibilityClaimV1 } from "@lervo/application-contract";
import { canonicalJson } from "@lervo/event-contract";
import { operatingContractHash, supervisedResponsibilityClaimFields } from "@lervo/work-controller";
import type { NativeOwnerPlanInput } from "./supervision-native-plans.js";
import { nativeTaskRequirement } from "./supervision-native-task.js";
import { prepareSupervisionWorkforcePlan } from "./supervision-workforce-planning.js";

/** Revises unstarted work through the same exact responsibility claim, never by editing a live lease. */
export async function nativeResponsibilityRevision(
  input: NativeOwnerPlanInput,
  details: Record<string, unknown>,
  rationaleArtifactHash: string,
) {
  if (
    Object.keys(details).length !== 2 ||
    typeof details.assignmentId !== "string" ||
    details.task === null ||
    typeof details.task !== "object" ||
    Array.isArray(details.task)
  )
    throw new Error("Responsibility revision requires one assignment and complete task details.");
  const assignment = input.facts.assignments.find(
    (item) => item.assignmentId === details.assignmentId,
  );
  const binding = input.facts.responsibilities.find(
    (item) => item.assignmentId === details.assignmentId,
  )?.binding;
  if (
    assignment === undefined ||
    binding === null ||
    binding === undefined ||
    assignment.recovery !== undefined ||
    !["queued", "leased"].includes(assignment.status) ||
    (assignment.lease !== null && Date.parse(assignment.lease.expiresAt) > Date.parse(input.now()))
  )
    throw new Error("The proposed responsibility has an unresolved live or terminal assignment.");
  const { task } = nativeTaskRequirement(input, details.task as Record<string, unknown>);
  task.assignmentId = assignment.assignmentId;
  const changesCriteria =
    operatingContractHash(task.acceptanceCriteria) !==
      operatingContractHash(assignment.acceptanceCriteria) ||
    operatingContractHash([...task.verificationSuiteIds].sort()) !==
      operatingContractHash([...assignment.verificationSuiteIds].sort());
  task.assignmentRevision = assignment.revision + (changesCriteria ? 2 : 1);
  task.predecessorBindingHash = binding.responsibilityHash;
  const planning = await prepareSupervisionWorkforcePlan({
    repositoryRoot: input.storage.paths.repositoryRoot,
    projectId: input.base.projectId,
    workstreamId: input.base.workstreamId,
    workstreamRevision: input.facts.workstream.revision,
    ownerAgentId: input.base.ownerAgentId,
    provider: input.base.provider as "codex" | "claude",
    responsibility: task,
    configuration: input.readiness,
    now: input.now,
  });
  if (planning.selection.agentId === null)
    throw new Error("No qualified available executor can receive the revised responsibility.");
  task.executorAgentId = planning.selection.agentId;
  const evidence = await input.storage.artifacts.put(
    canonicalJson({
      reasoningResult: input.resultArtifactHash,
      rationaleArtifactHash,
      planning: planning.evidence,
      workforce: planning.workforce,
      retrieval: planning.context.evidence,
    }),
  );
  const rationale = await input.storage.artifacts.put(
    canonicalJson(
      `${input.decision.rationale}\nGrounded reassignment alternatives: ${evidence.contentHash}`,
    ),
  );
  if (changesCriteria) {
    await input.storage.artifacts.put(canonicalJson(assignment));
    const effect: SupervisedAssignmentAmendmentV1 = {
      schemaVersion: 1,
      kind: "work.assignment_amendment",
      responsibility: task,
      expectedAssignmentHash: operatingContractHash(assignment),
      predecessorBindingHash: binding.responsibilityHash,
      provider: input.base.provider as "codex" | "claude",
      rationaleArtifactHash: rationale.contentHash,
    };
    return {
      effect,
      fields: supervisedAssignmentAmendmentFields(effect),
      rationaleArtifactHash: rationale.contentHash,
    };
  }
  const effect: SupervisedResponsibilityClaimV1 = {
    schemaVersion: 1,
    kind: "work.responsibility_claim",
    responsibility: task,
    expectedAssignmentHash: operatingContractHash(assignment),
    provider: input.base.provider as "codex" | "claude",
    leaseDurationMs: supervisionClaimDuration(task, input.now()),
    rationaleArtifactHash: rationale.contentHash,
  };
  return {
    effect,
    fields: supervisedResponsibilityClaimFields(effect),
    rationaleArtifactHash: rationale.contentHash,
  };
}
import { supervisionClaimDuration } from "./supervision-claim-duration.js";
