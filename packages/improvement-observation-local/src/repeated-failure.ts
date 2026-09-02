import { observationDigest } from "./digest.js";
import type { LocalMetricProjectionV1 } from "./metric-projection.js";
import type { LocalVerificationCompletionEvidenceV1 } from "./verification-completion-evidence.js";

function failureSignature(event: LocalVerificationCompletionEvidenceV1): string {
  return observationDigest({
    schemaVersion: 1,
    suiteHash: event.suiteHash,
    nonPassedCommandIds: event.nonPassedCommandIds,
  });
}

export function projectRepeatedFailure(
  projectId: string,
  completions: LocalVerificationCompletionEvidenceV1[],
): LocalMetricProjectionV1 | null {
  if (completions.length === 0) return null;
  const seenFailureSignatures = new Set<string>();
  let numerator = 0;
  const evidence = completions.map((event) => {
    const signatureHash = event.status === "failed" ? failureSignature(event) : null;
    const repeated = signatureHash !== null && seenFailureSignatures.has(signatureHash);
    if (repeated) numerator += 1;
    if (signatureHash !== null) seenFailureSignatures.add(signatureHash);
    return {
      eventId: event.eventId,
      eventHash: event.eventHash,
      occurredAt: event.occurredAt,
      runId: event.runId,
      verificationId: event.verificationId,
      status: event.status,
      failureSignatureHash: signatureHash,
      repeated,
    };
  });
  return {
    numerator,
    denominator: completions.length,
    evidenceSetHash: observationDigest({
      schemaVersion: 1,
      projectId,
      metricId: "repeated_failure",
      unit: "canonical_verification_completion_event",
      repeatedFailureSignature: "suite_hash_and_ordered_non_passed_command_ids",
      evidence,
    }),
  };
}
