import type { ManagedProviderRunResult } from "@lervo/execution-contract";
import type { DeliberationArtifactKind } from "@lervo/schemas";

import type { DeliberationEventRecorder } from "./event-recorder.js";
import type { DeliberationRuntimeCoordinates } from "./types.js";
import { DeliberationRuntimeError } from "./types.js";

export function recordPublicationFailure(input: {
  error: DeliberationRuntimeError;
  recorder: DeliberationEventRecorder;
  coordinates: DeliberationRuntimeCoordinates;
  deliberationId: string;
  kind: DeliberationArtifactKind;
  round: number;
  run: ManagedProviderRunResult;
  occurredAt: string;
  attempt: number;
  semanticEvaluatorProvider: "codex" | "claude" | "unknown";
}): void {
  const diagnostics = input.error.diagnostics ?? {};
  input.recorder.append({
    type: "deliberation.artifact.publication_failed",
    coordinates: {
      projectId: input.coordinates.projectId,
      runId: input.run.session.runId,
      sessionId: input.run.session.sessionId,
    },
    occurredAt: input.occurredAt,
    actor: { kind: "agent", provider: input.run.session.provider },
    payload: {
      deliberationId: input.deliberationId,
      kind: input.kind,
      round: input.round,
      producerRoleId: input.run.session.roleId,
      producerProvider: input.run.session.provider,
      semanticEvaluatorProvider: input.semanticEvaluatorProvider,
      attempt: input.attempt,
      artifactId: input.run.resultArtifact.artifactId,
      contentHash: input.run.resultArtifact.contentHash,
      repositoryVerificationStatus: input.run.verificationStatus,
      writingPublicationStatus: "failed",
      recoveryStatus: "quarantined",
      failureReason: input.error.reason,
      failedChecks: Array.isArray(diagnostics.failedChecks) ? diagnostics.failedChecks : [],
      missingChecks: Array.isArray(diagnostics.missingChecks) ? diagnostics.missingChecks : [],
      semanticEvaluationStatus:
        typeof diagnostics.semanticEvaluationStatus === "string"
          ? diagnostics.semanticEvaluationStatus
          : "unknown",
      repairAttemptLimit: 2,
    },
  });
}
