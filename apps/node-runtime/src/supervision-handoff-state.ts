import type { OperatingActionPlanV1 } from "@lervo/application-contract";
import type { ArtifactStore, EventStore } from "@lervo/storage-contract";
import type { SupervisionTaskSource } from "./supervision-task-source.js";
import type { NodeSupervisionBinding } from "./supervision-authority.js";
import { readSupervisionPeerFacts } from "./supervision-peer-facts.js";
import { readSupervisionJsonArtifact } from "./supervision-artifact-json.js";
import {
  supervisionHandoffReceiptBasis,
  inspectSupervisionHandoffReceipt,
} from "./supervision-handoff-receipt.js";

export async function readSupervisionHandoffState(
  storage: { events: EventStore; artifacts: ArtifactStore } & { projectId: string },
  source: Awaited<ReturnType<SupervisionTaskSource["read"]>>,
  binding: NodeSupervisionBinding,
  now: string,
) {
  const offers: { handoffHash: string; expiresAt: string }[] = [];
  const acceptedIncoming = new Set<string>();
  const acceptedOutgoing = new Set<string>();
  for (const event of source.supervisionEvents) {
    if (event.type === "work.supervision.peer.observed") {
      const observations = await readSupervisionPeerFacts(
        [event],
        storage.artifacts,
        binding,
        storage.projectId,
      );
      for (const observation of observations)
        for (const acceptance of observation.acceptances)
          acceptedOutgoing.add(acceptance.acceptance.handoffHash);
      continue;
    }
    if (
      !["work.supervision.handoff.offered", "work.supervision.handoff.accepted"].includes(
        event.type,
      )
    )
      continue;
    const plan = (await readSupervisionJsonArtifact(
      storage.artifacts,
      String(event.payload.planHash),
    )) as OperatingActionPlanV1;
    const receipt = await inspectSupervisionHandoffReceipt(storage, plan);
    if (receipt.status !== "confirmed" || receipt.eventIds[0] !== event.eventId)
      throw new Error("The handoff state has no exact local owner receipt.");
    const basis = await supervisionHandoffReceiptBasis(storage, plan);
    if (basis.effect.kind === "work.scoped_handoff_acceptance")
      acceptedIncoming.add(basis.effect.handoffHash);
    else if (basis.offer.sourceSnapshotHash === source.workstreamHash)
      offers.push({
        handoffHash: String(event.payload.handoffHash),
        expiresAt: basis.offer.expiresAt,
      });
  }
  const peers = await readSupervisionPeerFacts(
    source.events,
    storage.artifacts,
    binding,
    storage.projectId,
  );
  const pendingIncoming = peers
    .flatMap((peer) => (peer.status === "available" ? peer.incoming : []))
    .filter(
      (item) =>
        item.offer.recipientSnapshotHash === source.workstreamHash &&
        !acceptedIncoming.has(item.handoffHash) &&
        Date.parse(item.offer.expiresAt) > Date.parse(now),
    )
    .map((item) => item.handoffHash);
  const pendingOutgoing = offers.filter((offer) => !acceptedOutgoing.has(offer.handoffHash));
  return {
    acceptedIncoming: [...acceptedIncoming].sort(),
    acceptedOutgoing: [...acceptedOutgoing].sort(),
    pendingIncoming: [...new Set(pendingIncoming)].sort(),
    pendingOutgoing: [...new Set(pendingOutgoing.map((offer) => offer.handoffHash))].sort(),
    nextCheckAt:
      pendingOutgoing
        .map((offer) => offer.expiresAt)
        .sort((a, b) => Date.parse(a) - Date.parse(b))[0] ?? null,
  };
}
