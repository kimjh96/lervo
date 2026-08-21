import {
  deliberationPolicyHash,
  validateDeliberationHistory,
  type DeliberationVerificationEvidence,
} from "@lervo/deliberation";
import { maximumManagedRunEvidenceEvents } from "@lervo/execution-contract";
import type {
  DeliberationArtifact,
  EventEnvelope,
  SharedContextPublication,
} from "@lervo/schemas";
import { collectRunEventsBounded, visitEventSnapshot } from "@lervo/storage-contract";

import {
  DeliberationRuntimeError,
  type DeliberationRuntimeOptions,
  type DeliberationRuntimeSnapshot,
} from "./types.js";

function invalid(): never {
  throw new DeliberationRuntimeError(
    "runtime_state_invalid",
    "runtime_snapshot_invalid",
    "숙의 runtime snapshot이 현재 policy 또는 event 원본과 다릅니다.",
  );
}

export interface RestoredDeliberationRuntimeState {
  startedEventId: string;
  artifacts: DeliberationArtifact[];
  verificationEvidence: DeliberationVerificationEvidence[];
  recordedEvents: Map<string, string>;
  providerSessionRoles: Map<string, string>;
  publications: Map<string, {
    publication: SharedContextPublication;
    event: EventEnvelope;
  }>;
  handoffs: Map<string, string>;
}

function restoreDeliberationRuntimeSnapshotUnchecked(input: {
  snapshot: DeliberationRuntimeSnapshot;
  options: Pick<DeliberationRuntimeOptions, "deliberationId" | "events" | "policy">;
}): RestoredDeliberationRuntimeState {
  const { snapshot, options } = input;
  if (
    snapshot === null || typeof snapshot !== "object" || snapshot.schemaVersion !== 1 ||
    snapshot.deliberationId !== options.deliberationId ||
    snapshot.policyHash !== deliberationPolicyHash(options.policy) ||
    typeof snapshot.startedEventId !== "string" || !Array.isArray(snapshot.artifacts) ||
    !Array.isArray(snapshot.verificationEvidence) ||
    !Array.isArray(snapshot.providerSessionRoles) || !Array.isArray(snapshot.recordedEvents) ||
    !Array.isArray(snapshot.publications) || !Array.isArray(snapshot.handoffs)
  ) invalid();
  try {
    validateDeliberationHistory({
      policy: options.policy,
      artifacts: snapshot.artifacts,
      verificationEvidence: snapshot.verificationEvidence,
    });
  } catch {
    invalid();
  }
  const started = options.events.get(snapshot.startedEventId);
  if (
    started?.type !== "deliberation.started" ||
    started.payload.deliberationId !== snapshot.deliberationId ||
    started.payload.policyHash !== snapshot.policyHash
  ) invalid();
  const recorded = new Map(snapshot.recordedEvents.map((item) => [item.artifactId, item.eventId]));
  if (recorded.size !== snapshot.artifacts.length) invalid();
  for (const artifact of snapshot.artifacts) {
    const eventId = recorded.get(artifact.deliberationArtifactId);
    const event = eventId === undefined ? null : options.events.get(eventId);
    if (
      event?.type !== "deliberation.artifact.recorded" ||
      event.payload.deliberationArtifactId !== artifact.deliberationArtifactId ||
      event.payload.contentHash !== artifact.content.contentHash ||
      event.payload.producerRoleId !== artifact.producer.roleId
    ) invalid();
  }
  const recordedEventIds = new Set(snapshot.recordedEvents.map((item) => item.eventId));
  let currentArtifactEventCount = 0;
  let completed = false;
  try {
    visitEventSnapshot({
      events: options.events,
      throughSeq: options.events.latest()?.seq ?? 0,
      visit: (event) => {
        if (event.type === "deliberation.artifact.recorded" &&
          event.payload.deliberationId === snapshot.deliberationId) {
          currentArtifactEventCount += 1;
          if (!recordedEventIds.has(event.eventId)) invalid();
        }
        if (event.type === "deliberation.completed" &&
          event.payload.deliberationId === snapshot.deliberationId) completed = true;
      },
    });
  } catch {
    invalid();
  }
  if (currentArtifactEventCount !== recordedEventIds.size || completed) invalid();

  const artifactIds = new Set(snapshot.artifacts.map((artifact) =>
    artifact.deliberationArtifactId));
  const publicationArtifactIds = new Set(snapshot.publications.map((item) => item.artifactId));
  const handoffIds = new Set(snapshot.handoffs.map((item) => item.handoffId));
  if (
    publicationArtifactIds.size !== snapshot.artifacts.length ||
    snapshot.publications.length !== snapshot.artifacts.length ||
    handoffIds.size !== snapshot.handoffs.length ||
    snapshot.handoffs.length !== snapshot.artifacts.length * options.policy.participants.length
  ) invalid();
  for (const item of snapshot.publications) {
    const event = options.events.get(item.eventId);
    if (
      !artifactIds.has(item.artifactId) || event?.type !== "context.published" ||
      event.payload.sharedContextId !== item.publication.sharedContextId ||
      event.payload.contentHash !== item.publication.contentHash
    ) invalid();
    const artifact = snapshot.artifacts.find((candidate) =>
      candidate.deliberationArtifactId === item.artifactId)!;
    const recipientRoleIds = snapshot.handoffs.flatMap((handoff) => {
      const handoffEvent = options.events.get(handoff.eventId);
      return handoffEvent?.type === "handoff.created" &&
        handoffEvent.runId === artifact.producer.runId &&
        handoffEvent.sessionId === artifact.producer.sessionId &&
        handoffEvent.payload.fromRoleId === artifact.producer.roleId &&
        Array.isArray(handoffEvent.payload.sharedContextIds) &&
        handoffEvent.payload.sharedContextIds.includes(item.publication.sharedContextId)
        ? [handoffEvent.payload.toRoleId]
        : [];
    });
    const expectedRoleIds = options.policy.participants.map((participant) => participant.roleId);
    if (
      recipientRoleIds.length !== expectedRoleIds.length ||
      new Set(recipientRoleIds).size !== expectedRoleIds.length ||
      expectedRoleIds.some((roleId) => !recipientRoleIds.includes(roleId))
    ) invalid();
  }
  for (const item of snapshot.handoffs) {
    const event = options.events.get(item.eventId);
    if (event?.type !== "handoff.created" || event.payload.handoffId !== item.handoffId) invalid();
  }

  const providerSessionRoles = new Map<string, string>();
  if (snapshot.providerSessionRoles.length !== snapshot.artifacts.length) invalid();
  for (const item of snapshot.providerSessionRoles) {
    if (
      typeof item?.providerSessionId !== "string" || typeof item.roleId !== "string" ||
      providerSessionRoles.has(item.providerSessionId) ||
      !options.policy.participants.some((participant) => participant.roleId === item.roleId)
    ) invalid();
    const producedArtifact = snapshot.artifacts.find((artifact) => {
      if (artifact.producer.roleId !== item.roleId) return false;
      try {
        return collectRunEventsBounded({
          events: options.events,
          runId: artifact.producer.runId,
          maximumEvents: maximumManagedRunEvidenceEvents,
        }).some((event) => event.type === "adapter.started" &&
          event.payload.providerSessionId === item.providerSessionId);
      } catch {
        invalid();
      }
    });
    if (producedArtifact === undefined) invalid();
    providerSessionRoles.set(item.providerSessionId, item.roleId);
  }
  const publications = new Map(snapshot.publications.map((item) => [item.artifactId, {
    publication: structuredClone(item.publication),
    event: structuredClone(options.events.get(item.eventId)!),
  }]));
  return {
    startedEventId: snapshot.startedEventId,
    artifacts: structuredClone(snapshot.artifacts),
    verificationEvidence: structuredClone(snapshot.verificationEvidence),
    recordedEvents: recorded,
    providerSessionRoles,
    publications,
    handoffs: new Map(snapshot.handoffs.map((item) => [item.handoffId, item.eventId])),
  };
}

export function restoreDeliberationRuntimeSnapshot(input: {
  snapshot: DeliberationRuntimeSnapshot;
  options: Pick<DeliberationRuntimeOptions, "deliberationId" | "events" | "policy">;
}): RestoredDeliberationRuntimeState {
  try {
    return restoreDeliberationRuntimeSnapshotUnchecked(input);
  } catch (error) {
    if (error instanceof DeliberationRuntimeError && error.reason === "runtime_snapshot_invalid") {
      throw error;
    }
    throw new DeliberationRuntimeError(
      "runtime_state_invalid",
      "runtime_snapshot_invalid",
      "숙의 runtime snapshot이 현재 policy 또는 event 원본과 다릅니다.",
      { cause: error instanceof Error ? error : undefined },
    );
  }
}
