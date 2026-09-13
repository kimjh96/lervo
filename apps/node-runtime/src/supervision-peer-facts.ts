import type { ArtifactStore, EventStore } from "@lervo/storage-contract";
import {
  assertScopedHandoffRequest,
  assertScopedHandoffAcceptance,
  operatingContractHash,
} from "@lervo/work-controller";
import type { SupervisionPeerCatalogObservation } from "./supervision-peer-catalog-observation.js";
import { readSupervisionJsonArtifact } from "./supervision-artifact-json.js";
import type { NodeSupervisionBinding } from "./supervision-authority.js";

/** Recorded host observations inform judgement; the handoff adapter revalidates installed routes. */
export async function readSupervisionPeerFacts(
  events: ReturnType<EventStore["list"]>,
  artifacts: ArtifactStore,
  binding: NodeSupervisionBinding,
  projectId: string,
) {
  const latest = new Map<string, (typeof events)[number]>();
  for (const event of events)
    if (
      event.type === "work.supervision.peer.observed" &&
      event.projectId === projectId &&
      event.payload.supervisionId === binding.supervisionId &&
      event.payload.workstreamId === binding.workstreamId &&
      event.payload.mandateHash === binding.mandateHash &&
      event.payload.ownerAgentId === binding.ownerAgentId
    )
      latest.set(String(event.payload.peerProjectId), event);
  if (latest.size > 32)
    throw new Error("Recorded peer routes require retained-history compaction.");
  return Promise.all(
    [...latest.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(async ([peerProjectId, event]) => {
        const view = (await readSupervisionJsonArtifact(
          artifacts,
          String(event.payload.peerObservationHash),
        )) as SupervisionPeerCatalogObservation;
        if (
          event.schemaVersion !== 3 ||
          event.actor.kind !== "system" ||
          Object.keys(view).length !== 8 ||
          view.schemaVersion !== 1 ||
          view.kind !== "work.peer_observation" ||
          view.projectId !== peerProjectId ||
          view.routeHash !== event.payload.routeHash ||
          !["available", "unavailable"].includes(view.status) ||
          !Array.isArray(view.incoming) ||
          !Array.isArray(view.acceptances) ||
          view.incoming.length > 32 ||
          view.acceptances.length > 32 ||
          (view.status === "unavailable" &&
            (view.authority !== null ||
              view.incoming.length !== 0 ||
              view.acceptances.length !== 0)) ||
          (view.status === "available" && view.authority?.party.projectId !== peerProjectId)
        )
          throw new Error("The recorded peer observation is invalid.");
        for (const item of view.incoming) {
          assertScopedHandoffRequest(item.request, item.offer);
          if (
            item.handoffHash !== operatingContractHash(item.offer) ||
            item.offer.source.projectId !== peerProjectId ||
            item.offer.recipient.projectId !== projectId ||
            item.offer.recipient.workstreamId !== binding.workstreamId ||
            !/^evt_[a-f0-9]{32}$/u.test(item.eventId) ||
            !/^sha256:[a-f0-9]{64}$/u.test(item.eventHash)
          )
            throw new Error("The observed handoff targets another repository goal.");
        }
        for (const item of view.acceptances) {
          const offer = (await readSupervisionJsonArtifact(
            artifacts,
            item.acceptance.handoffHash,
          )) as Parameters<typeof assertScopedHandoffAcceptance>[1];
          assertScopedHandoffAcceptance(item.acceptance, offer);
          if (
            offer.source.projectId !== projectId ||
            offer.recipient.projectId !== peerProjectId ||
            operatingContractHash(offer) !== item.acceptance.handoffHash
          )
            throw new Error("The peer acceptance differs from the local offered scope.");
        }
        return view;
      }),
  );
}
