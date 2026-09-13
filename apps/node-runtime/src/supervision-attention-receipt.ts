import type { OperatingActionPlanV1 } from "@lervo/application-contract";
import type { ArtifactStore, EventStore } from "@lervo/storage-contract";
import { operatingContractHash } from "@lervo/work-controller";
import { readAdmittedControlDecision } from "./supervision-control-decision.js";
import { readSupervisionAttentionArtifact } from "./supervision-attention-artifact.js";

export async function supervisionAttentionReceiptBasis(
  storage: { events: EventStore; artifacts: ArtifactStore },
  plan: OperatingActionPlanV1,
) {
  const decision = await readAdmittedControlDecision(storage, plan);
  const basis = await readSupervisionAttentionArtifact(storage.artifacts, plan);
  const type = "work.supervision.escalation.recorded" as const;
  const eventId = `evt_${operatingContractHash({ runId: decision.runId, type, identity: decision.identity }).slice(7, 39)}`;
  const payload = {
    schemaVersion: 1,
    projectId: plan.projectId,
    workstreamId: plan.workstreamId,
    workstreamRevision: decision.decision.payload.workstreamRevision,
    supervisionId: plan.supervisionId,
    ownerAgentId: plan.ownerAgentId,
    mandateHash: plan.mandateHash,
    causationEventIds: [decision.decision.eventId],
    escalationId: decision.identity,
    recipientAgentId: plan.ownerAgentId,
    reasonCode: basis.effect.reasonCode,
    evidenceEventIds: plan.causationEventIds,
    decisionArtifactHash: operatingContractHash(plan),
    nextCheckAt: null,
  };
  return { ...decision, ...basis, eventId, payload, type };
}

export async function inspectSupervisionAttentionReceipt(
  storage: { events: EventStore; artifacts: ArtifactStore },
  plan: OperatingActionPlanV1,
) {
  const basis = await supervisionAttentionReceiptBasis(storage, plan);
  const event = storage.events.get(basis.eventId);
  if (event === null) return { status: "not_started" as const };
  if (
    event.type !== basis.type ||
    event.schemaVersion !== 3 ||
    event.actor.kind !== "system" ||
    event.projectId !== plan.projectId ||
    event.runId !== basis.runId ||
    event.seq <= basis.decision.seq ||
    operatingContractHash(event.payload) !== operatingContractHash(basis.payload)
  )
    throw new Error("The owner attention receipt conflicts with its exact admitted decision.");
  return { status: "confirmed" as const, eventIds: [event.eventId] };
}
