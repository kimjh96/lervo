import type {
  AssignmentConnectorRequestV1,
  AssignmentConnectorSourceObservationV1,
} from "@lervo/application-contract";
import { listAssignments } from "@lervo/agent-workforce";
import type { ProjectStorage } from "@lervo/project-storage";
import type { EventEnvelope } from "@lervo/schemas";
import { visitEventSnapshot } from "@lervo/storage-contract";

function sameStrings(left: unknown, right: string[]): boolean {
  return (
    Array.isArray(left) &&
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

export async function observeAssignmentConnectorSource(
  storage: ProjectStorage,
  request: AssignmentConnectorRequestV1,
): Promise<AssignmentConnectorSourceObservationV1> {
  const assignment = (await listAssignments(storage.paths.repositoryRoot)).find(
    (item) => item.assignmentId === request.assignmentId,
  );
  if (assignment === undefined) throw new Error("The connector route assignment does not exist.");
  const handoff = assignment.handoffs.find((item) => item.handoffId === request.handoffId);
  if (handoff === undefined) throw new Error("The connector route handoff does not exist.");
  const head = storage.events.latest();
  const matchingEvents: EventEnvelope[] = [];
  if (head !== null) {
    visitEventSnapshot({
      events: storage.events,
      throughSeq: head.seq,
      visit(event) {
        const payload = event.payload as Record<string, unknown>;
        if (
          event.type === "assignment.handoff.recorded" &&
          payload.assignmentId === assignment.assignmentId &&
          payload.handoffId === handoff.handoffId
        ) {
          matchingEvents.push(event);
        }
      },
    });
  }
  if (matchingEvents.length === 0)
    throw new Error("The connector route handoff has no canonical event evidence.");
  if (matchingEvents.length > 1)
    throw new Error("The connector route handoff has duplicate canonical events.");
  const event = matchingEvents[0]!;
  const payload = event.payload as Record<string, unknown>;
  if (
    event.occurredAt !== handoff.createdAt ||
    payload.fromAgentId !== handoff.fromAgentId ||
    payload.toAgentId !== handoff.toAgentId ||
    payload.requestDigest !== handoff.requestDigest ||
    !sameStrings(
      payload.artifactIds,
      handoff.artifactReferences.map((item) => item.artifactId),
    ) ||
    !sameStrings(
      payload.artifactHashes,
      handoff.artifactReferences.map((item) => item.contentHash),
    )
  )
    throw new Error("The connector route handoff state and event evidence differ.");
  return {
    projectId: storage.manifest.projectId,
    workstreamId: assignment.workstreamId,
    assignmentId: assignment.assignmentId,
    assignmentRevision: assignment.revision,
    handoffId: handoff.handoffId,
    handoffEventId: event.eventId,
    fromAgentId: handoff.fromAgentId,
    toAgentId: handoff.toAgentId,
    requestDigest: handoff.requestDigest,
    artifactReferences: handoff.artifactReferences.map((item) => ({ ...item })),
    routeRecordedAt: handoff.createdAt,
  };
}
