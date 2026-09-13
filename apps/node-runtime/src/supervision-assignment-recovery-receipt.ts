import type { OperatingActionPlanV1 } from "@lervo/application-contract";
import { listAssignments } from "@lervo/agent-workforce";
import type { ProjectStorage } from "@lervo/project-storage";
import { managedExecutionIdentity, operatingContractHash } from "@lervo/work-controller";
import { readAdmittedControlDecision } from "./supervision-control-decision.js";
import { readAssignmentRecoveryEffect } from "./supervision-assignment-recovery-source.js";

export function assignmentRecoveryEventId(plan: OperatingActionPlanV1) {
  return `evt_${operatingContractHash({ planHash: operatingContractHash(plan), type: "assignment.reopened" }).slice(7, 39)}`;
}

export async function inspectAssignmentRecoveryReceipt(
  storage: ProjectStorage,
  plan: OperatingActionPlanV1,
) {
  const admitted = await readAdmittedControlDecision(storage, plan);
  const { effect, previous } = await readAssignmentRecoveryEffect(storage, plan);
  const event = storage.events.get(assignmentRecoveryEventId(plan));
  const current = (await listAssignments(storage.paths.repositoryRoot)).find(
    (item) => item.assignmentId === previous.assignmentId,
  );
  if (event === null)
    return {
      status:
        operatingContractHash(current ?? null) === effect.recovery.predecessorAssignmentHash
          ? ("not_started" as const)
          : ("uncertain" as const),
    };
  const expected = {
    ...previous,
    status: "queued",
    lease: null,
    lastLeaseGeneration: effect.recovery.predecessorLeaseGeneration,
    recovery: effect.recovery,
    revision: previous.revision + 1,
    updatedAt: event.occurredAt,
  };
  const identity = managedExecutionIdentity(plan.projectId, operatingContractHash(plan));
  if (
    event.type !== "assignment.reopened" ||
    event.schemaVersion !== 3 ||
    event.actor.kind !== "system" ||
    event.seq <= admitted.decision.seq ||
    event.policyVersion !== plan.mandateHash ||
    event.runId !== identity.runId ||
    event.sessionId !== identity.sessionId ||
    operatingContractHash(current ?? null) !== operatingContractHash(expected) ||
    operatingContractHash(event.payload) !==
      operatingContractHash({
        assignmentId: previous.assignmentId,
        assignmentRevision: expected.revision,
        assignmentHash: operatingContractHash(expected),
        ...effect.recovery,
      })
  )
    return { status: "uncertain" as const };
  return { status: "confirmed" as const, eventIds: [event.eventId] };
}
