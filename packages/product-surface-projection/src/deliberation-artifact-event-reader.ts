import {
  type DeliberationArtifact,
  type DeliberationArtifactRecordedEventPayload,
  type EventEnvelope,
  validateSchema,
} from "@lervo/schemas";

export type DeliberationArtifactEventReadResult =
  | {
      status: "complete";
      artifacts: DeliberationArtifact[];
      artifactEventIds: string[];
      missingArtifactEventIds: [];
      invalidArtifactEventIds: [];
      reasonCode: null;
    }
  | {
      status: "unavailable";
      artifacts: null;
      artifactEventIds: string[];
      missingArtifactEventIds: string[];
      invalidArtifactEventIds: [];
      reasonCode: "deliberation_structured_artifact_unavailable";
    }
  | {
      status: "invalid";
      artifacts: null;
      artifactEventIds: string[];
      missingArtifactEventIds: string[];
      invalidArtifactEventIds: string[];
      reasonCode: "deliberation_structured_artifact_invalid";
    };

function coordinatesMatch(
  event: EventEnvelope,
  payload: DeliberationArtifactRecordedEventPayload & { artifact: DeliberationArtifact },
): boolean {
  const artifact = payload.artifact;
  return (
    artifact.projectId === event.projectId &&
    artifact.deliberationId === payload.deliberationId &&
    artifact.deliberationArtifactId === payload.deliberationArtifactId &&
    artifact.kind === payload.kind &&
    artifact.round === payload.round &&
    artifact.producer.roleId === payload.producerRoleId &&
    artifact.producer.runId === event.runId &&
    artifact.producer.sessionId === event.sessionId &&
    event.actor.kind === "agent" &&
    event.actor.provider === artifact.producer.provider &&
    artifact.content.artifactId === payload.artifactId &&
    artifact.content.contentHash === payload.contentHash &&
    artifact.writingPublicationPermit.permitId === payload.writingPermitId &&
    artifact.createdAt === event.occurredAt
  );
}

export function readDeliberationArtifactEvents(input: {
  deliberationId: string;
  events: readonly EventEnvelope[];
}): DeliberationArtifactEventReadResult {
  const relevant = input.events
    .filter(
      (event) =>
        event.type === "deliberation.artifact.recorded" &&
        event.payload.deliberationId === input.deliberationId,
    )
    .toSorted((left, right) => left.seq - right.seq);
  const artifactEventIds = relevant.map((event) => event.eventId);
  const missingArtifactEventIds: string[] = [];
  const invalidArtifactEventIds: string[] = [];
  const artifacts: DeliberationArtifact[] = [];
  const seenEventSequences = new Set<number>();
  const seenArtifactIds = new Set<string>();

  for (const event of relevant) {
    if (seenEventSequences.has(event.seq)) {
      invalidArtifactEventIds.push(event.eventId);
      continue;
    }
    seenEventSequences.add(event.seq);
    const validation = validateSchema("deliberationArtifactRecordedEventPayload", event.payload);
    if (!validation.valid) {
      invalidArtifactEventIds.push(event.eventId);
      continue;
    }
    const payload = event.payload as DeliberationArtifactRecordedEventPayload;
    if (payload.artifact === undefined) {
      missingArtifactEventIds.push(event.eventId);
      continue;
    }
    if (
      seenArtifactIds.has(payload.artifact.deliberationArtifactId) ||
      !coordinatesMatch(
        event,
        payload as DeliberationArtifactRecordedEventPayload & { artifact: DeliberationArtifact },
      )
    ) {
      invalidArtifactEventIds.push(event.eventId);
      continue;
    }
    seenArtifactIds.add(payload.artifact.deliberationArtifactId);
    artifacts.push(structuredClone(payload.artifact));
  }

  if (invalidArtifactEventIds.length > 0) {
    return {
      status: "invalid",
      artifacts: null,
      artifactEventIds,
      missingArtifactEventIds,
      invalidArtifactEventIds,
      reasonCode: "deliberation_structured_artifact_invalid",
    };
  }
  if (missingArtifactEventIds.length > 0) {
    return {
      status: "unavailable",
      artifacts: null,
      artifactEventIds,
      missingArtifactEventIds,
      invalidArtifactEventIds: [],
      reasonCode: "deliberation_structured_artifact_unavailable",
    };
  }
  return {
    status: "complete",
    artifacts,
    artifactEventIds,
    missingArtifactEventIds: [],
    invalidArtifactEventIds: [],
    reasonCode: null,
  };
}
