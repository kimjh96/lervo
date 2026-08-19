import type { DeliberationArtifact, DeliberationPolicy } from "@lervo/schemas";
import { validateSchema } from "@lervo/schemas";

import type { DeliberationEventRecorder } from "./event-recorder.js";
import {
  DeliberationRuntimeError,
  type PublishDeliberationHandoffInput,
  type PublishedDeliberationHandoff,
} from "./types.js";

function clone<T>(value: T): T {
  return structuredClone(value);
}

export function publishDeliberationHandoff(input: {
  request: PublishDeliberationHandoffInput;
  artifact: DeliberationArtifact | undefined;
  artifactEventId: string | undefined;
  policy: DeliberationPolicy;
  recorder: DeliberationEventRecorder;
}): PublishedDeliberationHandoff {
  const { publication, handoff } = input.request;
  const artifact = input.artifact;
  if (
    artifact === undefined || input.artifactEventId === undefined ||
    !validateSchema("sharedContext", publication).valid ||
    publication.projectId !== artifact.projectId ||
    publication.contentHash !== artifact.content.contentHash ||
    publication.producer.kind !== "agent" ||
    publication.producer.roleId !== artifact.producer.roleId ||
    publication.producer.runId !== artifact.producer.runId ||
    publication.producer.sessionId !== artifact.producer.sessionId ||
    !publication.evidenceEventIds.includes(input.artifactEventId)
  ) {
    throw new DeliberationRuntimeError(
      "artifact_publication_failed",
      "publication_artifact_mismatch",
      "Shared context publication이 기록된 숙의 artifact와 다릅니다.",
    );
  }
  const audienceAllowsRecipient = publication.audience.mode === "project" ||
    publication.audience.roleIds.includes(handoff.toRoleId);
  if (
    !validateSchema("handoffBundle", handoff).valid ||
    handoff.projectId !== artifact.projectId ||
    handoff.from.roleId !== artifact.producer.roleId ||
    handoff.from.runId !== artifact.producer.runId ||
    handoff.from.sessionId !== artifact.producer.sessionId ||
    handoff.from.contextGeneration !== artifact.inputContext.contextGeneration ||
    !handoff.sharedContextIds.includes(publication.sharedContextId) ||
    !handoff.evidenceEventIds.includes(input.artifactEventId) ||
    !audienceAllowsRecipient ||
    !input.policy.participants.some((item) => item.roleId === handoff.toRoleId)
  ) {
    throw new DeliberationRuntimeError(
      "artifact_publication_failed",
      "publication_handoff_invalid",
      "Handoff가 artifact 생산자, shared context 또는 수신 역할과 다릅니다.",
    );
  }
  const coordinates = {
    projectId: artifact.projectId,
    runId: artifact.producer.runId,
    sessionId: artifact.producer.sessionId,
  };
  const [publishedEvent, handoffEvent] = input.recorder.appendMany([
    {
      type: "context.published",
      coordinates,
      occurredAt: publication.publishedAt,
      actor: { kind: "agent", provider: artifact.producer.provider },
      payload: {
        sharedContextId: publication.sharedContextId,
        documentId: publication.documentId,
        contentHash: publication.contentHash,
        producerRoleId: artifact.producer.roleId,
        audienceMode: publication.audience.mode,
        allowedRoleIds: publication.audience.mode === "roles"
          ? publication.audience.roleIds
          : [],
        expiresAt: publication.expiresAt,
      },
    },
    {
      type: "handoff.created",
      coordinates,
      occurredAt: handoff.createdAt,
      actor: { kind: "agent", provider: artifact.producer.provider },
      payload: {
        handoffId: handoff.handoffId,
        fromRoleId: handoff.from.roleId,
        toRoleId: handoff.toRoleId,
        sharedContextIds: handoff.sharedContextIds,
        evidenceEventIds: handoff.evidenceEventIds,
        requestDigest: handoff.requestDigest,
      },
    },
  ]);
  return {
    publication: clone(publication),
    handoff: clone(handoff),
    publishedEvent: publishedEvent!,
    handoffEvent: handoffEvent!,
  };
}
