import type { OperatingActionPlanV1 } from "@lervo/application-contract";
import { operatingContractHash } from "@lervo/work-controller";
import { readSupervisionJsonArtifact } from "./supervision-artifact-json.js";
import type { readSupervisionHandoffArtifact } from "./supervision-handoff-artifact.js";
import { inspectSupervisionHandoffReceipt } from "./supervision-handoff-receipt.js";
import {
  SupervisionPeerSource,
  type NodeSupervisionPeerConfiguration,
} from "./supervision-peer-source.js";

/** The recipient reads a policy-admitted offer from its pinned source; CAS possession grants nothing. */
export async function observeSupervisionHandoffPeer(input: {
  peers: readonly NodeSupervisionPeerConfiguration[];
  basis: Awaited<ReturnType<typeof readSupervisionHandoffArtifact>>;
  now(): string;
}) {
  const { effect, offer } = input.basis;
  const party = effect.kind === "work.scoped_handoff" ? offer.recipient : offer.source;
  const routes = input.peers.filter(
    (peer) =>
      peer.projectId === party.projectId &&
      peer.teamId === party.teamId &&
      peer.binding.workstreamId === party.workstreamId &&
      peer.binding.ownerAgentId === party.ownerAgentId &&
      peer.binding.mandateHash === party.mandateHash,
  );
  if (routes.length !== 1) throw new Error("The handoff requires one exact installed peer route.");
  const peer = await SupervisionPeerSource.open(routes[0]!, input.now);
  try {
    const observation = await peer.read();
    const expectedSnapshot =
      effect.kind === "work.scoped_handoff"
        ? offer.recipientSnapshotHash
        : offer.sourceSnapshotHash;
    if (
      operatingContractHash(observation.party) !== operatingContractHash(party) ||
      observation.workstreamSnapshotHash !== expectedSnapshot ||
      observation.workstreamStatus !== "active"
    )
      throw new Error("The peer workstream changed before scoped handoff admission.");
    if (effect.kind === "work.scoped_handoff_acceptance") {
      const receipt = peer.storage.events.get(effect.sourceOfferEventId);
      if (
        receipt === null ||
        receipt.type !== "work.supervision.handoff.offered" ||
        receipt.eventHash !== effect.sourceOfferEventHash ||
        receipt.payload.handoffHash !== effect.handoffHash
      )
        throw new Error("The successor acceptance has no exact source offer receipt.");
      const plan = (await readSupervisionJsonArtifact(
        peer.storage.artifacts,
        String(receipt.payload.planHash),
      )) as OperatingActionPlanV1;
      if (
        plan.effectHash !== effect.handoffHash ||
        plan.effectContract !== "work.scoped_handoff.v1"
      )
        throw new Error("The source offer receipt belongs to another admitted effect.");
      const inspected = await inspectSupervisionHandoffReceipt(peer.storage, plan);
      if (inspected.status !== "confirmed" || inspected.eventIds[0] !== receipt.eventId)
        throw new Error("The source handoff was not committed under its admitted owner decision.");
    }
    const head = observation.eventHeadHash;
    return {
      peer,
      observation,
      validateHead() {
        if ((peer.storage.events.latest()?.eventHash ?? null) !== head)
          throw new Error("The peer authority changed before handoff commit.");
      },
    };
  } catch (error) {
    await peer.close();
    throw error;
  }
}
