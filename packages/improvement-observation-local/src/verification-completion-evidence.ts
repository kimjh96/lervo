import {
  ImprovementObservationPortError,
  type ImprovementObservationWindowV1,
} from "@lervo/application-contract";
import { type VerificationCompletedEventPayload, validateSchema } from "@lervo/schemas";

import type { LocalImprovementEvidenceSnapshotV1 } from "./types.js";

export interface LocalVerificationCompletionEvidenceV1 {
  eventId: string;
  eventHash: string;
  occurredAt: string;
  runId: string;
  verificationId: string;
  suiteHash: string;
  status: "passed" | "failed" | "cancelled";
  nonPassedCommandIds: string[];
}

function statusCoordinatesValid(payload: VerificationCompletedEventPayload): boolean {
  if (payload.status === "passed") return payload.nonPassedCommandIds.length === 0;
  if (payload.status === "failed") return payload.nonPassedCommandIds.length > 0;
  return true;
}

export function normalizeVerificationCompletions(
  snapshot: LocalImprovementEvidenceSnapshotV1,
  window: ImprovementObservationWindowV1,
): LocalVerificationCompletionEvidenceV1[] {
  const startedAt = Date.parse(window.startedAt);
  const endedAt = Date.parse(window.endedAt);
  if (
    snapshot.schemaVersion !== 1 ||
    !Number.isFinite(startedAt) ||
    !Number.isFinite(endedAt) ||
    startedAt > endedAt
  )
    throw new ImprovementObservationPortError(
      "evidence_invalid",
      "The local verification-completion snapshot is invalid.",
    );

  let previousSeq = 0;
  const evidence = snapshot.events.map((event) => {
    const occurredAt = Date.parse(event.occurredAt);
    if (
      event.projectId !== snapshot.projectId ||
      event.seq <= previousSeq ||
      !Number.isFinite(occurredAt) ||
      occurredAt < startedAt ||
      occurredAt > endedAt ||
      event.type !== "verification.completed" ||
      !validateSchema("event", event).valid ||
      !validateSchema("verificationCompletedEventPayload", event.payload).valid
    )
      throw new ImprovementObservationPortError(
        "evidence_invalid",
        "A local verification-completion event is invalid.",
      );
    previousSeq = event.seq;
    const payload = event.payload as VerificationCompletedEventPayload;
    if (!statusCoordinatesValid(payload))
      throw new ImprovementObservationPortError(
        "evidence_invalid",
        "A local verification status contradicts its non-passed command coordinates.",
      );
    return {
      eventId: event.eventId,
      eventHash: event.eventHash,
      occurredAt: event.occurredAt,
      runId: event.runId,
      verificationId: payload.verificationId,
      suiteHash: payload.suiteHash,
      status: payload.status,
      nonPassedCommandIds: [...payload.nonPassedCommandIds],
    };
  });
  if (new Set(evidence.map((item) => item.verificationId)).size !== evidence.length)
    throw new ImprovementObservationPortError(
      "evidence_invalid",
      "A verification identity occurs more than once in the observation window.",
    );
  return evidence;
}
