import type { ProjectStorage } from "@lervo/project-storage";
import type { PassedWorkflowVerificationEvidence } from "@lervo/repository-knowledge";
import {
  validateSchema,
  type EventEnvelope,
  type VerificationCompletedEventPayload,
} from "@lervo/schemas";
import { visitEventSnapshot } from "@lervo/storage-contract";

export function passedWorkflowVerificationEvidence(
  storage: ProjectStorage,
): PassedWorkflowVerificationEvidence[] {
  const evidence: PassedWorkflowVerificationEvidence[] = [];
  const latest = storage.events.latest();
  if (latest === null) return evidence;
  visitEventSnapshot({
    events: storage.events,
    throughSeq: latest.seq,
    visit: (event: EventEnvelope) => {
      if (event.type !== "verification.completed") return;
      if (
        !validateSchema("event", event).valid ||
        !validateSchema("verificationCompletedEventPayload", event.payload).valid
      )
        throw new Error("The workflow verification event is invalid.");
      const payload = event.payload as VerificationCompletedEventPayload;
      if (payload.status !== "passed" || payload.nonPassedCommandIds.length !== 0) return;
      evidence.push({
        eventId: event.eventId,
        eventHash: event.eventHash,
        runId: event.runId,
        verificationId: payload.verificationId,
        suiteHash: payload.suiteHash,
        repositoryRevision: payload.repositoryRevision,
        resultContentHash: payload.resultContentHash,
      });
    },
  });
  return evidence;
}
