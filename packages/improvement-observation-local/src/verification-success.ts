import {
  ImprovementObservationPortError,
  type ImprovementObservationWindowV1,
} from "@lervo/application-contract";
import { type VerificationCompletedEventPayload, validateSchema } from "@lervo/schemas";

import { observationDigest } from "./digest.js";
import type { LocalImprovementEvidenceSnapshotV1 } from "./types.js";

export interface VerificationSuccessEvidenceV1 {
  numerator: number;
  denominator: number;
  evidenceSetHash: string;
}

export function projectVerificationSuccess(
  snapshot: LocalImprovementEvidenceSnapshotV1,
  window: ImprovementObservationWindowV1,
): VerificationSuccessEvidenceV1 | null {
  const startedAt = Date.parse(window.startedAt);
  const endedAt = Date.parse(window.endedAt);
  let previousSeq = 0;
  const evidence = snapshot.events.map((event) => {
    const occurredAt = Date.parse(event.occurredAt);
    if (
      snapshot.schemaVersion !== 1 ||
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
    return {
      eventId: event.eventId,
      eventHash: event.eventHash,
      occurredAt: event.occurredAt,
      runId: event.runId,
      verificationId: payload.verificationId,
      status: payload.status,
    };
  });
  if (evidence.length === 0) return null;
  if (new Set(evidence.map((item) => item.verificationId)).size !== evidence.length)
    throw new ImprovementObservationPortError(
      "evidence_invalid",
      "A verification identity occurs more than once in the observation window.",
    );
  return {
    numerator: evidence.filter((item) => item.status === "passed").length,
    denominator: evidence.length,
    evidenceSetHash: observationDigest({
      schemaVersion: 1,
      projectId: snapshot.projectId,
      metricId: "verification_success",
      unit: "canonical_verification_completion_event",
      evidence,
    }),
  };
}
