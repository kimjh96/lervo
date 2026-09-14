import { SupervisionMandateJournal } from "@lervo/agent-workforce";
import {
  collectRunEventsBounded,
  type ArtifactStore,
  type EventStore,
} from "@lervo/storage-contract";
import { operatingContractHash } from "@lervo/work-controller";
import { NodeSupervisionError, type NodeSupervisionBinding } from "./supervision-authority.js";

/** Retains an admitted event only when its mandate precedes the verified current installation. */
export async function hasInstalledMandateLineage(input: {
  events: EventStore;
  artifacts: ArtifactStore;
  projectId: string;
  binding: NodeSupervisionBinding;
  candidate: ReturnType<EventStore["list"]>[number];
}): Promise<boolean> {
  const { events, artifacts, projectId, binding, candidate } = input;
  if (
    candidate.schemaVersion !== 3 ||
    candidate.projectId !== projectId ||
    candidate.actor.kind !== "system" ||
    candidate.payload.supervisionId !== binding.supervisionId ||
    candidate.payload.workstreamId !== binding.workstreamId ||
    candidate.payload.ownerAgentId !== binding.ownerAgentId
  )
    return false;
  const runId = `run_${operatingContractHash({ supervisionId: binding.supervisionId }).slice(7, 39)}`;
  if (candidate.runId !== runId) return false;
  const journal = new SupervisionMandateJournal(
    events,
    artifacts,
    {
      ...binding,
      projectId,
      workstreamRevision: Number(candidate.payload.workstreamRevision),
      sessionId: candidate.sessionId,
      policyVersion: candidate.policyVersion,
    },
    () => candidate.occurredAt,
    null,
  );
  const current = await journal.current();
  if (
    current === null ||
    current.revoked ||
    current.mandateHash !== binding.mandateHash ||
    current.mandate.ownerAgentId !== binding.ownerAgentId
  )
    throw new NodeSupervisionError("supervision_binding_invalid");
  const installations = collectRunEventsBounded({ events, runId, maximumEvents: 4096 }).filter(
    (event) => event.type === "work.supervision.mandate.installed",
  );
  const currentIndex = installations.findIndex((event) => event.eventId === current.eventId);
  return (
    currentIndex >= 0 &&
    installations
      .slice(0, currentIndex + 1)
      .some(
        (event) =>
          event.seq < candidate.seq && event.payload.mandateHash === candidate.payload.mandateHash,
      )
  );
}
