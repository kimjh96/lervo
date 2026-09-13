import type { OperatingActionPlanV1 } from "@lervo/application-contract";
import type { ArtifactStore, EventStore } from "@lervo/storage-contract";
import { operatingContractHash } from "@lervo/work-controller";
import { readAdmittedControlDecision } from "./supervision-control-decision.js";
import { readSupervisionHandoffArtifact } from "./supervision-handoff-artifact.js";

export async function supervisionHandoffReceiptBasis(
  storage: { events: EventStore; artifacts: ArtifactStore },
  plan: OperatingActionPlanV1,
) {
  const admitted = await readAdmittedControlDecision(storage, plan);
  const artifact = await readSupervisionHandoffArtifact(storage.artifacts, plan);
  const { effect, offer } = artifact;
  const party = effect.kind === "work.scoped_handoff" ? offer.source : offer.recipient;
  if (
    ["projectId", "teamId", "workstreamId", "ownerAgentId", "mandateHash"].some(
      (key) => party[key as keyof typeof party] !== plan[key as keyof OperatingActionPlanV1],
    ) ||
    party.workstreamRevision !== admitted.decision.payload.workstreamRevision
  )
    throw new Error("The scoped handoff receipt differs from its admitted local authority.");
  const type =
    effect.kind === "work.scoped_handoff"
      ? ("work.supervision.handoff.offered" as const)
      : ("work.supervision.handoff.accepted" as const);
  const payload = {
    schemaVersion: 1,
    projectId: plan.projectId,
    workstreamId: plan.workstreamId,
    workstreamRevision: party.workstreamRevision,
    supervisionId: plan.supervisionId,
    ownerAgentId: plan.ownerAgentId,
    mandateHash: plan.mandateHash,
    causationEventIds: [admitted.decision.eventId],
    decisionId: admitted.identity,
    planHash: operatingContractHash(plan),
    handoffHash: operatingContractHash(offer),
    ...(effect.kind === "work.scoped_handoff"
      ? {
          recipientProjectId: offer.recipient.projectId,
          recipientWorkstreamId: offer.recipient.workstreamId,
          recipientAgentId: offer.recipient.ownerAgentId,
        }
      : {
          sourceProjectId: offer.source.projectId,
          sourceWorkstreamId: offer.source.workstreamId,
          sourceOfferEventId: effect.sourceOfferEventId,
          sourceOfferEventHash: effect.sourceOfferEventHash,
          acceptanceArtifactHash: operatingContractHash(effect),
        }),
  };
  const eventId = `evt_${operatingContractHash({ runId: admitted.runId, type, identity: admitted.identity }).slice(7, 39)}`;
  return { ...admitted, ...artifact, type, payload, eventId };
}

/** An immutable local receipt remains observable after either workstream advances. */
export async function inspectSupervisionHandoffReceipt(
  storage: { events: EventStore; artifacts: ArtifactStore },
  plan: OperatingActionPlanV1,
) {
  const basis = await supervisionHandoffReceiptBasis(storage, plan);
  const event = storage.events.get(basis.eventId);
  if (event === null) return { status: "not_started" as const };
  if (
    event.projectId !== plan.projectId ||
    event.runId !== basis.runId ||
    event.type !== basis.type ||
    event.schemaVersion !== 3 ||
    event.actor.kind !== "system" ||
    event.seq <= basis.decision.seq ||
    operatingContractHash(event.payload) !== operatingContractHash(basis.payload)
  )
    throw new Error("The scoped handoff receipt conflicts with its exact policy decision.");
  return { status: "confirmed" as const, eventIds: [event.eventId] };
}

export async function recordSupervisionHandoffReceipt(input: {
  storage: { events: EventStore; artifacts: ArtifactStore };
  plan: OperatingActionPlanV1;
  now(): string;
  commit<T>(effect: () => T): T;
  validateCurrent(): Promise<() => void>;
}) {
  const basis = await supervisionHandoffReceiptBasis(input.storage, input.plan);
  const existing = await inspectSupervisionHandoffReceipt(input.storage, input.plan);
  if (existing.status === "confirmed") return { eventIds: existing.eventIds };
  const validate = await input.validateCurrent();
  input.commit(() =>
    input.storage.events.transact((transaction) => {
      validate();
      const result = transaction.append({
        eventId: basis.eventId,
        projectId: input.plan.projectId,
        runId: basis.runId,
        sessionId: basis.decision.sessionId,
        type: basis.type,
        schemaVersion: 3,
        occurredAt: input.now(),
        actor: { kind: "system" },
        policyVersion: input.plan.mandateHash,
        payload: basis.payload,
      });
      if (result.redactions.length > 0) throw new Error("The handoff receipt was redacted.");
    }),
  );
  return { eventIds: [basis.eventId] };
}
