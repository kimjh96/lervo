import type {
  OperatingActionPlanV1,
  OperatingMandate,
  SupervisedAssignmentRecovery,
} from "@lervo/application-contract";
import { listWorkspaces, type WorkforceAssignment } from "@lervo/agent-workforce";
import type { ProjectStorage } from "@lervo/project-storage";
import {
  evaluateResponsibilityClaim,
  operatingContractHash,
  supervisedAssignmentRecoveryFields,
} from "@lervo/work-controller";
import { readSupervisionJsonArtifact } from "./supervision-artifact-json.js";
import { observeSupervisionTasks } from "./supervision-task-observation.js";
import type { SupervisionTaskSource } from "./supervision-task-source.js";

export async function readAssignmentRecoveryEffect(
  storage: ProjectStorage,
  plan: OperatingActionPlanV1,
) {
  const effect = (await readSupervisionJsonArtifact(
    storage.artifacts,
    plan.effectHash,
  )) as SupervisedAssignmentRecovery;
  const fields = supervisedAssignmentRecoveryFields(effect);
  if (
    Object.entries(fields).some(
      ([key, value]) =>
        operatingContractHash(value) !==
        operatingContractHash(plan[key as keyof OperatingActionPlanV1]),
    )
  )
    throw new Error("The recovery effect differs from its exact admitted fields.");
  const previous = (await readSupervisionJsonArtifact(
    storage.artifacts,
    effect.recovery.predecessorAssignmentHash,
  )) as WorkforceAssignment;
  if (
    previous.assignmentId !== effect.responsibility.assignmentId ||
    previous.revision + 2 !== effect.responsibility.assignmentRevision ||
    (effect.schemaVersion === 2
      ? previous.status !== "leased" ||
        previous.lease?.leaseId !== effect.settledLeaseId ||
        previous.lease.generation !== effect.recovery.predecessorLeaseGeneration
      : previous.lastLeaseGeneration !== effect.recovery.predecessorLeaseGeneration ||
        previous.lease !== null ||
        previous.status !== (effect.recovery.kind === "rework" ? "completed" : "failed")) ||
    effect.recovery.attemptNumber !== (previous.recovery?.attemptNumber ?? 1) + 1
  )
    throw new Error("The recovery predecessor or attempt lineage is inconsistent.");
  const rationale = await readSupervisionJsonArtifact(
    storage.artifacts,
    effect.rationaleArtifactHash,
  );
  if (typeof rationale !== "string" || rationale.trim().length === 0)
    throw new Error("The recovery rationale is unavailable.");
  return { effect, fields, previous };
}

export async function readCanonicalAssignmentRecovery(input: {
  storage: ProjectStorage;
  source: Awaited<ReturnType<SupervisionTaskSource["read"]>>;
  plan: OperatingActionPlanV1;
  mandate: OperatingMandate;
  now(): string;
}) {
  const { storage, source, plan, mandate } = input;
  const basis = await readAssignmentRecoveryEffect(storage, plan);
  const { effect, previous } = basis;
  const assignment = source.assignments.find((item) => item.assignmentId === previous.assignmentId);
  const binding = source.responsibilities.find(
    (item) => item.assignmentId === previous.assignmentId,
  )?.binding;
  const tasks = await observeSupervisionTasks(source, storage.artifacts, plan, storage.events);
  const observed = tasks.assignments.find((item) => item.assignmentId === previous.assignmentId);
  const terminal = source.events.find((event) => event.eventId === effect.recovery.terminalEventId);
  const prepared = source.events.find(
    (event) =>
      event.type === "assignment.completion.prepared" &&
      event.runId === terminal?.runId &&
      event.payload.assignmentId === previous.assignmentId,
  );
  const claim = source.events.find(
    (event) =>
      event.type === "assignment.claimed" &&
      event.payload.assignmentId === previous.assignmentId &&
      event.payload.leaseId ===
        (effect.schemaVersion === 2 ? effect.settledLeaseId : prepared?.payload.leaseId),
  );
  if (
    source.workstream.status !== "active" ||
    source.graph.validity.status !== "valid" ||
    source.graph.graphHash !== plan.graphHash ||
    assignment === undefined ||
    operatingContractHash(assignment) !== effect.recovery.predecessorAssignmentHash ||
    binding?.responsibilityHash !== effect.recovery.responsibilityHash ||
    effect.responsibility.reviewerAgentId !== plan.ownerAgentId ||
    effect.recovery.attemptNumber > Math.min(4, mandate.maximumAttemptsPerAssignment) ||
    (effect.recovery.kind === "retry"
      ? observed?.effectDisposition !== "known_safe_failure" ||
        observed.status !== "failed" ||
        terminal?.type !== "run.failed"
      : observed?.review?.verdict !== "rework" ||
        observed.review.eventId !== effect.recovery.reviewEventId ||
        observed.effectDisposition !== "reconciled") ||
    observed?.terminalEventId !== effect.recovery.terminalEventId ||
    terminal?.runId !== effect.recovery.sourceRunId ||
    claim?.payload.generation !== effect.recovery.predecessorLeaseGeneration ||
    evaluateResponsibilityClaim({
      source: {
        ...previous,
        revision: previous.revision + 1,
        liveLease: false,
        predecessorBindingHash: binding?.responsibilityHash ?? null,
      },
      responsibility: effect.responsibility,
      maximumDeadlineMs: mandate.maximumDeadlineMs,
      now: input.now(),
    }).status !== "ready"
  )
    throw new Error(
      "The recovery lacks exact current rejected acceptance, terminal evidence or scoped successor duties.",
    );
  const workspaces = (await listWorkspaces(storage.paths.repositoryRoot)).filter(
    (item) => item.assignmentId === previous.assignmentId,
  );
  if (
    workspaces
      .filter((item) => item.state !== "removed")
      .some(
        (item) =>
          !["ready", "paused"].includes(item.state) ||
          item.writerSession !== null ||
          item.recoveryReason !== null ||
          item.leaseGeneration > effect.recovery.predecessorLeaseGeneration,
      )
  )
    throw new Error("Recovery must first reconcile an active or uncertain workspace writer.");
  return { ...basis, assignment, workspaces };
}
