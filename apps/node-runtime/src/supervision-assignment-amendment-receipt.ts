import type { OperatingActionPlanV1 } from "@lervo/application-contract";
import { amendedAssignment, listAssignments } from "@lervo/agent-workforce";
import type { ProjectStorage } from "@lervo/project-storage";
import { managedExecutionIdentity, operatingContractHash } from "@lervo/work-controller";
import { readAdmittedControlDecision } from "./supervision-control-decision.js";
import { readAssignmentAmendmentEffect } from "./supervision-assignment-amendment-source.js";

export function assignmentAmendmentEventId(plan: OperatingActionPlanV1) {
  return `evt_${operatingContractHash({ planHash: operatingContractHash(plan), type: "assignment.amended" }).slice(7, 39)}`;
}
export async function inspectAssignmentAmendmentReceipt(
  storage: ProjectStorage,
  plan: OperatingActionPlanV1,
) {
  const admitted = await readAdmittedControlDecision(storage, plan);
  const { effect, previous } = await readAssignmentAmendmentEffect(storage, plan);
  const event = storage.events.get(assignmentAmendmentEventId(plan));
  const current = (await listAssignments(storage.paths.repositoryRoot)).find(
    (item) => item.assignmentId === previous.assignmentId,
  );
  if (event === null)
    return {
      status:
        operatingContractHash(current ?? null) === effect.expectedAssignmentHash
          ? ("not_started" as const)
          : ("uncertain" as const),
    };
  const expected = amendedAssignment(previous, effect, event.occurredAt);
  const identity = managedExecutionIdentity(plan.projectId, operatingContractHash(plan));
  if (
    event.type !== "assignment.amended" ||
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
        ...expected.amendment,
      })
  )
    return { status: "uncertain" as const };
  return { status: "confirmed" as const, eventIds: [event.eventId] };
}
