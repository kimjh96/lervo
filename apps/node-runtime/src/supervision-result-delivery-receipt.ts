import type { OperatingActionPlanV1, SupervisedResultDelivery } from "@lervo/application-contract";
import type { ArtifactStore, EventStore } from "@lervo/storage-contract";
import { validateSchema } from "@lervo/schemas";
import { assertSupervisedResultDelivery, operatingContractHash } from "@lervo/work-controller";
import { readAdmittedControlDecision } from "./supervision-control-decision.js";
import { readSupervisionJsonArtifact } from "./supervision-artifact-json.js";

type Storage = { events: EventStore; artifacts: ArtifactStore };
export async function expectedResultDelivery(
  storage: Storage,
  plan: OperatingActionPlanV1,
  effect: SupervisedResultDelivery,
) {
  assertSupervisedResultDelivery(effect, plan);
  const admitted = await readAdmittedControlDecision(storage, plan);
  const { decision, runId, identity } = admitted;
  const common = {
    schemaVersion: 1,
    projectId: plan.projectId,
    workstreamId: plan.workstreamId,
    workstreamRevision: decision.payload.workstreamRevision,
    supervisionId: plan.supervisionId,
    ownerAgentId: plan.ownerAgentId,
    mandateHash: plan.mandateHash,
    causationEventIds: [decision.eventId],
  };
  const payload = {
    ...common,
    decisionId: identity,
    planHash: operatingContractHash(plan),
    completionEventId: effect.completionEventId,
    resultArtifactHash: effect.resultArtifactHash,
    candidateArtifactHash: effect.candidateArtifactHash,
    outboundArtifactHash: effect.outboundArtifactHash,
  };
  const eventId = `evt_${operatingContractHash({ runId, type: "work.supervision.delivery.queued", identity }).slice(7, 39)}`;
  return { ...admitted, eventId, common, payload };
}

/** Each replay keeps the same outbound. Transport receipts prove delivery separately from queueing. */
export async function readResultDeliveryReceipt(
  storage: Storage,
  plan: OperatingActionPlanV1,
  effect: SupervisedResultDelivery,
) {
  const expected = await expectedResultDelivery(storage, plan, effect);
  const queued = storage.events.get(expected.eventId);
  if (queued === null)
    return { ...expected, status: "not_started" as const, attempt: 0, nextCheckAt: null };
  if (
    queued.type !== "work.supervision.delivery.queued" ||
    queued.projectId !== plan.projectId ||
    queued.runId !== expected.runId ||
    queued.schemaVersion !== 3 ||
    queued.actor.kind !== "system" ||
    queued.seq <= expected.decision.seq ||
    operatingContractHash(queued.payload) !== operatingContractHash(expected.payload)
  )
    throw new Error("The result delivery queue differs from its exact decision.");
  let state: {
    status: "pending" | "failed" | "delivered";
    attempt: number;
    nextCheckAt: string | null;
  } = { status: "pending", attempt: 0, nextCheckAt: queued.occurredAt };
  for (let attempt = 1; attempt <= 4; attempt++) {
    const id = `evt_${operatingContractHash({ runId: expected.runId, type: "work.supervision.delivery.observed", identity: `${expected.identity}:${attempt}` }).slice(7, 39)}`;
    const event = storage.events.get(id);
    if (event === null) break;
    const payload = event.payload;
    if (
      state.status === "delivered" ||
      event.projectId !== plan.projectId ||
      event.runId !== expected.runId ||
      event.actor.kind !== "system" ||
      event.schemaVersion !== 3 ||
      event.type !== "work.supervision.delivery.observed" ||
      event.seq <= queued.seq ||
      payload.decisionId !== expected.identity ||
      payload.planHash !== operatingContractHash(plan) ||
      payload.attemptNumber !== attempt ||
      Object.entries(expected.common).some(
        ([key, value]) => operatingContractHash(payload[key]) !== operatingContractHash(value),
      )
    )
      throw new Error("The result delivery observation is inconsistent.");
    if (payload.status === "delivered") {
      const receipt = (await readSupervisionJsonArtifact(
        storage.artifacts,
        String(payload.receiptArtifactHash),
      )) as Record<string, unknown>;
      const outbound = (await readSupervisionJsonArtifact(
        storage.artifacts,
        effect.outboundArtifactHash,
      )) as { outboundId: string; target: { integrationId: string } };
      if (
        !validateSchema("conversationDeliveryReceipt", receipt).valid ||
        receipt.outboundId !== outbound.outboundId ||
        payload.outboundId !== outbound.outboundId ||
        receipt.integrationId !== outbound.target.integrationId
      )
        throw new Error("The delivery receipt differs from its queued outbound.");
    }
    state = {
      status: payload.status as "failed" | "delivered",
      attempt,
      nextCheckAt: payload.nextCheckAt as string | null,
    };
  }
  return { ...expected, ...state };
}
