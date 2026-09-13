import type {
  OperatingActionPlanV1,
  ScopedWorkHandoffV1,
  ScopedWorkHandoffAcceptanceV1,
  ScopedWorkHandoffRequestV1,
} from "@lervo/application-contract";
import { collectRunEventsBounded } from "@lervo/storage-contract";
import { operatingContractHash } from "@lervo/work-controller";
import { readSupervisionJsonArtifact } from "./supervision-artifact-json.js";
import {
  supervisionHandoffReceiptBasis,
  inspectSupervisionHandoffReceipt,
} from "./supervision-handoff-receipt.js";
import type { SupervisionPeerSource } from "./supervision-peer-source.js";

export interface SupervisionPeerCatalogObservation {
  schemaVersion: 1;
  kind: "work.peer_observation";
  projectId: string;
  routeHash: string;
  status: "available" | "unavailable";
  authority: Omit<
    Awaited<ReturnType<SupervisionPeerSource["read"]>>,
    "observedAt" | "eventHeadHash"
  > | null;
  incoming: {
    handoffHash: string;
    offer: ScopedWorkHandoffV1;
    request: ScopedWorkHandoffRequestV1;
    eventId: string;
    eventHash: string;
  }[];
  acceptances: { acceptance: ScopedWorkHandoffAcceptanceV1; eventId: string; eventHash: string }[];
}

/** Rebuildable peer view; only exact policy-admitted receipts cross this observation boundary. */
export async function observeSupervisionPeerCatalog(input: {
  peer: SupervisionPeerSource;
  supervisionId: string;
  projectId: string;
  workstreamId: string;
  routeHash: string;
}) {
  const observed = await input.peer.read();
  const { observedAt: _time, eventHeadHash: _head, ...authority } = observed;
  const result: SupervisionPeerCatalogObservation = {
    schemaVersion: 1,
    kind: "work.peer_observation",
    projectId: authority.party.projectId,
    routeHash: input.routeHash,
    status: "available",
    authority,
    incoming: [],
    acceptances: [],
  };
  const runId = `run_${operatingContractHash({ supervisionId: input.supervisionId }).slice(7, 39)}`;
  const events = collectRunEventsBounded({
    events: input.peer.storage.events,
    runId,
    maximumEvents: 4096,
  });
  for (const event of events) {
    if (
      !["work.supervision.handoff.offered", "work.supervision.handoff.accepted"].includes(
        event.type,
      )
    )
      continue;
    const directed =
      event.type === "work.supervision.handoff.offered"
        ? event.payload.recipientProjectId === input.projectId &&
          event.payload.recipientWorkstreamId === input.workstreamId
        : event.payload.sourceProjectId === input.projectId &&
          event.payload.sourceWorkstreamId === input.workstreamId;
    if (!directed) continue;
    const plan = (await readSupervisionJsonArtifact(
      input.peer.storage.artifacts,
      String(event.payload.planHash),
    )) as OperatingActionPlanV1;
    const inspected = await inspectSupervisionHandoffReceipt(input.peer.storage, plan);
    if (inspected.status !== "confirmed" || inspected.eventIds[0] !== event.eventId)
      throw new Error("A peer handoff observation has no exact admitted receipt.");
    const basis = await supervisionHandoffReceiptBasis(input.peer.storage, plan);
    if (basis.effect.kind === "work.scoped_handoff")
      result.incoming.push({
        handoffHash: operatingContractHash(basis.offer),
        offer: basis.offer,
        request: basis.request,
        eventId: event.eventId,
        eventHash: event.eventHash,
      });
    else
      result.acceptances.push({
        acceptance: basis.effect,
        eventId: event.eventId,
        eventHash: event.eventHash,
      });
    if (result.incoming.length > 32 || result.acceptances.length > 32)
      throw new Error("The peer handoff view requires retained-history compaction.");
  }
  if ((input.peer.storage.events.latest()?.eventHash ?? null) !== observed.eventHeadHash)
    throw new Error("The peer changed while observing its handoff receipts.");
  return result;
}
