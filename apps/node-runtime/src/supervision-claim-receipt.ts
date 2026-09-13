import type {
  OperatingActionPlanV1,
  SupervisedResponsibilityClaimV1,
} from "@lervo/application-contract";
import { listAssignments } from "@lervo/agent-workforce";
import type { ProjectStorage } from "@lervo/project-storage";
import { operatingContractHash, supervisedResponsibilityClaimFields } from "@lervo/work-controller";
import { readAdmittedControlDecision } from "./supervision-control-decision.js";
import { readSupervisionJsonArtifact } from "./supervision-artifact-json.js";
import { readInstalledNodeMandate, type NodeSupervisionBinding } from "./supervision-authority.js";

export async function readSupervisionClaimReceiptBasis(
  storage: ProjectStorage,
  binding: NodeSupervisionBinding,
  plan: OperatingActionPlanV1,
  now: () => string,
) {
  const admitted = await readAdmittedControlDecision(storage, plan);
  const effect = (await readSupervisionJsonArtifact(
    storage.artifacts,
    plan.effectHash,
  )) as SupervisedResponsibilityClaimV1;
  const fields = supervisedResponsibilityClaimFields(effect);
  if (
    Object.entries(fields).some(
      ([key, value]) =>
        operatingContractHash(value) !==
        operatingContractHash(plan[key as keyof OperatingActionPlanV1]),
    )
  )
    throw new Error("The recorded claim differs from its exact operating decision.");
  const installation = await readInstalledNodeMandate(storage, binding, now);
  const claim = {
    responsibility: effect.responsibility,
    expectedAssignmentHash: effect.expectedAssignmentHash,
    sessionId: `ses_${operatingContractHash(plan).slice(7, 39)}`,
    leaseDurationMs: effect.leaseDurationMs,
    maximumDeadlineMs: installation.mandate.maximumDeadlineMs,
    causationEventIds: [...new Set([admitted.decision.eventId, ...plan.causationEventIds])],
  };
  if (claim.causationEventIds.length > 63)
    throw new Error("The claim causation exceeds its bound.");
  const requestHash = operatingContractHash(claim);
  const bindingEventId = `evt_${operatingContractHash({ runId: admitted.runId, type: "work.responsibility.bound", identity: requestHash }).slice(7, 39)}`;
  return { effect, claim, requestHash, bindingEventId, ...admitted };
}

/** A confirmed historical claim proves acquisition, never current lease validity or provider start. */
export async function inspectSupervisionClaim(
  storage: ProjectStorage,
  binding: NodeSupervisionBinding,
  plan: OperatingActionPlanV1,
  now: () => string,
) {
  const basis = await readSupervisionClaimReceiptBasis(storage, binding, plan, now);
  const task = basis.effect.responsibility;
  const event = storage.events.get(basis.bindingEventId);
  const assignment = (await listAssignments(storage.paths.repositoryRoot)).find(
    (item) => item.assignmentId === task.assignmentId,
  );
  if (event === null)
    return {
      status:
        assignment !== undefined &&
        operatingContractHash(assignment) === basis.effect.expectedAssignmentHash
          ? ("not_started" as const)
          : ("uncertain" as const),
    };
  const causes = event.payload.causationEventIds;
  const claimEvent = Array.isArray(causes) ? storage.events.get(String(causes.at(-1))) : null;
  if (
    event.type !== "work.responsibility.bound" ||
    event.schemaVersion !== 3 ||
    event.actor.kind !== "system" ||
    event.runId !== basis.runId ||
    event.projectId !== plan.projectId ||
    event.seq <= basis.decision.seq ||
    ["supervisionId", "workstreamId", "ownerAgentId", "mandateHash"].some(
      (key) => event.payload[key] !== plan[key as keyof OperatingActionPlanV1],
    ) ||
    event.payload.assignmentId !== task.assignmentId ||
    event.payload.assignmentRevision !== task.assignmentRevision ||
    event.payload.executorAgentId !== task.executorAgentId ||
    event.payload.reviewerAgentId !== task.reviewerAgentId ||
    ["roleId", "roleVersion", "roleContractHash", "predecessorBindingHash"].some(
      (key) => event.payload[key] !== task[key as keyof typeof task],
    ) ||
    operatingContractHash(
      await readSupervisionJsonArtifact(
        storage.artifacts,
        String(event.payload.responsibilityArtifactHash),
      ),
    ) !== operatingContractHash(task) ||
    !Array.isArray(causes) ||
    operatingContractHash(causes.slice(0, -1)) !==
      operatingContractHash(basis.claim.causationEventIds) ||
    claimEvent === null ||
    claimEvent.type !== "assignment.claimed" ||
    claimEvent.schemaVersion !== 3 ||
    claimEvent.runId !== basis.runId ||
    claimEvent.seq !== event.seq - 1 ||
    claimEvent.payload.assignmentId !== task.assignmentId ||
    claimEvent.eventId !==
      `evt_${operatingContractHash({ runId: basis.runId, type: "assignment.claimed", identity: `${basis.requestHash}:${claimEvent.payload.leaseId}` }).slice(7, 39)}` ||
    assignment === undefined ||
    assignment.revision < task.assignmentRevision
  )
    return { status: "uncertain" as const };
  return { status: "confirmed" as const, eventIds: [claimEvent.eventId, event.eventId] };
}
