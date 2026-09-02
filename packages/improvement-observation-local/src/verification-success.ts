import { observationDigest } from "./digest.js";
import type { LocalMetricProjectionV1 } from "./metric-projection.js";
import type { LocalVerificationCompletionEvidenceV1 } from "./verification-completion-evidence.js";

export function projectVerificationSuccess(
  projectId: string,
  completions: LocalVerificationCompletionEvidenceV1[],
): LocalMetricProjectionV1 | null {
  if (completions.length === 0) return null;
  const evidence = completions.map((event) => ({
    eventId: event.eventId,
    eventHash: event.eventHash,
    occurredAt: event.occurredAt,
    runId: event.runId,
    verificationId: event.verificationId,
    status: event.status,
  }));
  return {
    numerator: evidence.filter((item) => item.status === "passed").length,
    denominator: evidence.length,
    evidenceSetHash: observationDigest({
      schemaVersion: 1,
      projectId,
      metricId: "verification_success",
      unit: "canonical_verification_completion_event",
      evidence,
    }),
  };
}
