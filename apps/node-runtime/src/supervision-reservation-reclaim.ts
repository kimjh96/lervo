import type {
  OperatingActionPlanV1,
  SupervisedManagedExecution,
  SupervisedResponsibilityClaimV1,
} from "@lervo/application-contract";
import { canonicalJson } from "@lervo/event-contract";
import type { ProjectStorage } from "@lervo/project-storage";
import { collectRunEventsBounded } from "@lervo/storage-contract";
import {
  isManagedExecutionAbsence,
  managedExecutionAbsenceEventsMatch,
  managedExecutionIdentity,
  operatingContractHash,
  supervisedResponsibilityClaimFields,
} from "@lervo/work-controller";
import type { SupervisionTaskSource } from "./supervision-task-source.js";
import type { canonicalOwnerReasoningFacts } from "./supervision-reasoning-context.js";
import type { NodeRuntimeReadinessConfiguration } from "./supervision-runtime-configuration.js";
import { readSupervisionJsonArtifact } from "./supervision-artifact-json.js";
import { prepareSupervisionWorkforcePlan } from "./supervision-workforce-planning.js";
import { supervisionClaimDuration } from "./supervision-claim-duration.js";

type Source = Awaited<ReturnType<SupervisionTaskSource["read"]>>;
type Facts = Awaited<ReturnType<typeof canonicalOwnerReasoningFacts>>["facts"];

/** Reclaims one exact reservation-only, unstarted retry without another owner model turn. */
export async function reclaimReservationOnlyLease(input: {
  storage: ProjectStorage;
  source: Source;
  facts: Facts;
  base: OperatingActionPlanV1;
  assignmentIds: readonly string[];
  readiness: NodeRuntimeReadinessConfiguration;
  now(): string;
}): Promise<OperatingActionPlanV1 | null> {
  if (input.assignmentIds.length !== 1) return null;
  const assignment = input.source.assignments.find(
    (item) => item.assignmentId === input.assignmentIds[0],
  );
  const binding = input.source.responsibilities.find(
    (item) => item.assignmentId === assignment?.assignmentId,
  )?.binding;
  const task = input.facts.tasks.assignments.find(
    (item) => item.assignmentId === assignment?.assignmentId,
  );
  const now = Date.parse(input.now());
  if (
    assignment?.status !== "leased" ||
    assignment.recovery?.kind !== "retry" ||
    assignment.lease === null ||
    Date.parse(assignment.lease.expiresAt) > now ||
    task?.effectDisposition !== "not_started" ||
    task.dispatchedAt !== null ||
    task.terminalEventId !== null ||
    binding === null ||
    binding === undefined ||
    binding.responsibility.assignmentRevision !== assignment.revision
  )
    return null;
  const reopened = input.source.events.findLast(
    (event) =>
      event.type === "assignment.reopened" &&
      event.payload.assignmentId === assignment.assignmentId,
  );
  if (reopened === undefined) return null;
  const supersessions = input.source.events.filter(
    (event) => event.type === "work.supervision.decision.superseded" && event.seq > reopened.seq,
  );
  const matching: { plan: OperatingActionPlanV1; eventId: string }[] = [];
  for (const supersession of supersessions) {
    const decision = input.source.events.find(
      (event) =>
        event.type === "work.supervision.decision.recorded" &&
        event.payload.decisionId === supersession.payload.decisionId,
    );
    if (decision === undefined) return null;
    const plan = (await readSupervisionJsonArtifact(
      input.storage.artifacts,
      String(decision.payload.planArtifactHash),
    )) as OperatingActionPlanV1;
    if (plan.effectContract !== "work.managed_execution.v2") continue;
    const effect = (await readSupervisionJsonArtifact(
      input.storage.artifacts,
      plan.effectHash,
    )) as SupervisedManagedExecution;
    if (effect.responsibility.assignmentId !== assignment.assignmentId) continue;
    const inspection = (await readSupervisionJsonArtifact(
      input.storage.artifacts,
      String(supersession.payload.inspectionArtifactHash),
    )) as Record<string, unknown>;
    if (inspection.schemaVersion !== 5) continue;
    if (
      effect.schemaVersion !== 2 ||
      supersession.payload.planHash !== operatingContractHash(plan) ||
      !isManagedExecutionAbsence(
        inspection,
        plan,
        String(supersession.payload.sourceRevisionDigest),
      ) ||
      !managedExecutionAbsenceEventsMatch(
        inspection,
        plan,
        collectRunEventsBounded({
          events: input.storage.events,
          runId: managedExecutionIdentity(plan.projectId, operatingContractHash(plan)).runId,
          maximumEvents: 4096,
        }),
      )
    )
      return null;
    matching.push({ plan, eventId: supersession.eventId });
  }
  if (
    matching.length !== 1 ||
    matching[0]!.plan.responsibilityArtifactHash !== binding.responsibilityHash
  )
    return null;
  const predecessor = binding.responsibility;
  const acquiredAt = Date.parse(assignment.lease.acquiredAt);
  const deadlines = [
    predecessor.startDeadline,
    predecessor.progressDeadline,
    predecessor.completionDeadline,
  ].map((value) => Date.parse(value) - acquiredAt);
  if (
    !deadlines.every((duration) => Number.isSafeInteger(duration) && duration > 5000) ||
    deadlines[0]! >= deadlines[1]! ||
    deadlines[1]! >= deadlines[2]! ||
    deadlines[2]! > input.facts.mandate.maximumDeadlineMs ||
    now + deadlines[2]! >= Date.parse(input.facts.mandate.expiresAt)
  )
    return null;
  const responsibility = {
    ...predecessor,
    assignmentRevision: assignment.revision + 1,
    startDeadline: new Date(now + deadlines[0]!).toISOString(),
    progressDeadline: new Date(now + deadlines[1]!).toISOString(),
    completionDeadline: new Date(now + deadlines[2]!).toISOString(),
    predecessorBindingHash: binding.responsibilityHash,
  };
  const planning = await prepareSupervisionWorkforcePlan({
    repositoryRoot: input.storage.paths.repositoryRoot,
    projectId: input.base.projectId,
    workstreamId: input.base.workstreamId,
    workstreamRevision: input.facts.workstream.revision,
    ownerAgentId: input.base.ownerAgentId,
    provider: input.base.provider as "codex" | "claude",
    responsibility,
    configuration: input.readiness,
    now: input.now,
  });
  if (planning.selection.agentId !== predecessor.executorAgentId) return null;
  const rationale = await input.storage.artifacts.put(
    canonicalJson(
      `Reclaim the unchanged unstarted duty after exact reservation-only supersession ${matching[0]!.eventId}; predecessor ${binding.responsibilityHash}; current workforce plan ${planning.planHash}.`,
    ),
  );
  const effect: SupervisedResponsibilityClaimV1 = {
    schemaVersion: 1,
    kind: "work.responsibility_claim",
    responsibility,
    expectedAssignmentHash: operatingContractHash(assignment),
    provider: input.base.provider as "codex" | "claude",
    leaseDurationMs: supervisionClaimDuration(responsibility, input.now()),
    rationaleArtifactHash: rationale.contentHash,
  };
  await input.storage.artifacts.put(canonicalJson(effect));
  return { ...input.base, ...supervisedResponsibilityClaimFields(effect) };
}
