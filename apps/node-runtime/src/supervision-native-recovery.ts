import type { SupervisedAssignmentRecovery } from "@lervo/application-contract";
import { canonicalJson } from "@lervo/event-contract";
import { operatingContractHash, supervisedAssignmentRecoveryFields } from "@lervo/work-controller";
import type { NativeOwnerPlanInput } from "./supervision-native-plans.js";
import { nativeTaskRequirement } from "./supervision-native-task.js";
import { prepareSupervisionWorkforcePlan } from "./supervision-workforce-planning.js";

/** Translates owner-proposed rework into one exact recovery plan before successor lease acquisition. */
export async function nativeAssignmentRecovery(
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
    throw new Error("Rework requires one assignment and complete successor task details.");
  const retry = input.decision.operation === "retry_attempt";
  const previous = input.facts.assignments.find(
    (item) => item.assignmentId === details.assignmentId,
  );
  const observed = input.facts.tasks.assignments.find(
    (item) => item.assignmentId === details.assignmentId,
  );
  const binding = input.facts.responsibilities.find(
    (item) => item.assignmentId === details.assignmentId,
  )?.binding;
  const terminal =
    observed?.terminalEventId === null || observed === undefined
      ? null
      : input.storage.events.get(observed.terminalEventId);
  if (
    previous === undefined ||
    !(retry ? ["failed", "leased"] : ["completed", "leased"]).includes(previous.status) ||
    (previous.status === "leased"
      ? previous.lease === null
      : previous.lastLeaseGeneration === undefined) ||
    (retry
      ? observed?.effectDisposition !== "known_safe_failure" || observed.status !== "failed"
      : observed?.review?.verdict !== "rework" || observed.review.eventId === undefined) ||
    binding === null ||
    binding === undefined ||
    terminal?.type !== (retry ? "run.failed" : "run.completed")
  )
    throw new Error("The native rework proposal has no current rejected completed assignment.");
  const { task } = nativeTaskRequirement(input, details.task as Record<string, unknown>);
  task.assignmentId = previous.assignmentId;
  task.assignmentRevision = previous.revision + 2;
  task.predecessorBindingHash = binding.responsibilityHash;
  const planning = await prepareSupervisionWorkforcePlan({
    repositoryRoot: input.storage.paths.repositoryRoot,
    projectId: input.base.projectId,
    workstreamId: input.base.workstreamId,
    workstreamRevision: input.facts.workstream.revision,
    ownerAgentId: input.base.ownerAgentId,
    provider: input.base.provider as "codex" | "claude",
    responsibility: task,
    ...(previous.status === "leased"
      ? {
          settledPredecessor: {
            assignmentHash: operatingContractHash(previous),
            leaseId: previous.lease!.leaseId,
          },
        }
      : {}),
    configuration: input.readiness,
    now: input.now,
  });
  if (planning.selection.agentId === null)
    throw new Error("No ready qualified worker is available for rework.");
  task.executorAgentId = planning.selection.agentId;
  const original = await input.storage.artifacts.put(canonicalJson(previous));
  if (original.contentHash !== operatingContractHash(previous))
    throw new Error("The recovery predecessor artifact hash differs.");
  const effect: SupervisedAssignmentRecovery = {
    ...(previous.status === "leased"
      ? { schemaVersion: 2 as const, settledLeaseId: previous.lease!.leaseId }
      : { schemaVersion: 1 as const }),
    kind: "work.assignment_recovery",
    responsibility: task,
    recovery: {
      kind: retry ? "retry" : "rework",
      predecessorAssignmentHash: original.contentHash,
      responsibilityHash: binding.responsibilityHash,
      sourceRunId: terminal!.runId,
      terminalEventId: terminal!.eventId,
      reviewEventId: retry ? null : observed!.review!.eventId!,
      attemptNumber: (previous.recovery?.attemptNumber ?? 1) + 1,
      predecessorLeaseGeneration: previous.lease?.generation ?? previous.lastLeaseGeneration!,
    },
    provider: input.base.provider as "codex" | "claude",
    rationaleArtifactHash,
  };
  return { effect, fields: supervisedAssignmentRecoveryFields(effect) };
}
