import {
  type DeliberationArtifact,
  type DeliberationCompletedEventPayload,
  type DeliberationOutcome,
  type DeliberationPolicy,
  type EventEnvelope,
  validateSchema,
} from "@lervo/schemas";

import {
  deliberationPolicyHash,
  type DeliberationVerificationEvidence,
  validateDeliberationOutcome,
} from "@lervo/deliberation";

export type DeliberationOutcomeEventReadResult =
  | {
      status: "active";
      outcome: null;
      completedEventId: null;
      reasonCode: null;
    }
  | {
      status: "complete";
      outcome: DeliberationOutcome;
      completedEventId: string;
      reasonCode: null;
    }
  | {
      status: "invalid";
      outcome: null;
      completedEventId: string | null;
      reasonCode: "deliberation_outcome_event_invalid";
    };

function baseOutcome(input: {
  policy: DeliberationPolicy;
  deliberationId: string;
  artifacts: readonly DeliberationArtifact[];
  event: EventEnvelope;
  payload: DeliberationCompletedEventPayload;
}) {
  return {
    schemaVersion: 1 as const,
    outcomeId: input.payload.outcomeId,
    deliberationId: input.deliberationId,
    projectId: input.policy.projectId,
    policyId: input.policy.policyId,
    policyHash: deliberationPolicyHash(input.policy),
    lastRound: input.payload.lastRound,
    artifactIds: input.artifacts.map((artifact) => artifact.deliberationArtifactId),
    lastConfirmedArtifactId: input.artifacts.at(-1)?.deliberationArtifactId ?? null,
    passedVerificationArtifactIds: input.artifacts
      .filter(
        (artifact) => artifact.kind === "verification" && artifact.details.status === "passed",
      )
      .map((artifact) => artifact.deliberationArtifactId),
    unresolvedBlockingObjectionIds: [...input.payload.unresolvedBlockingObjectionIds],
    completedAt: input.event.occurredAt,
  };
}

function outcomeCandidates(input: {
  policy: DeliberationPolicy;
  deliberationId: string;
  artifacts: readonly DeliberationArtifact[];
  event: EventEnvelope;
  payload: DeliberationCompletedEventPayload;
}): DeliberationOutcome[] {
  const base = baseOutcome(input);
  const payload = input.payload;
  if (payload.status === "converged") {
    return [
      {
        ...base,
        status: "converged",
        decisionArtifactId: payload.decisionArtifactId,
        noConsensusReason: null,
        failure: null,
      },
    ];
  }
  if (payload.status === "no_consensus") {
    return [
      "max_rounds_reached",
      "blocking_objections_unresolved",
      "required_verification_not_passed",
    ].map((noConsensusReason) => ({
      ...base,
      status: "no_consensus" as const,
      decisionArtifactId: null,
      noConsensusReason: noConsensusReason as Extract<
        DeliberationOutcome,
        { status: "no_consensus" }
      >["noConsensusReason"],
      failure: null,
    }));
  }
  return [false, true].map((retryable) => ({
    ...base,
    status: "failed" as const,
    decisionArtifactId: null,
    noConsensusReason: null,
    failure: {
      phase: payload.failurePhase,
      code: payload.failureCode,
      retryable,
    },
  }));
}

export function readDeliberationOutcomeEvent(input: {
  deliberationId: string;
  policy: DeliberationPolicy;
  artifacts: readonly DeliberationArtifact[];
  verificationEvidence: readonly DeliberationVerificationEvidence[];
  events: readonly EventEnvelope[];
}): DeliberationOutcomeEventReadResult {
  const completed = input.events.filter(
    (event) =>
      event.type === "deliberation.completed" &&
      event.payload.deliberationId === input.deliberationId,
  );
  if (completed.length === 0) {
    return { status: "active", outcome: null, completedEventId: null, reasonCode: null };
  }
  if (completed.length !== 1) {
    return {
      status: "invalid",
      outcome: null,
      completedEventId: null,
      reasonCode: "deliberation_outcome_event_invalid",
    };
  }
  const event = completed[0]!;
  const validation = validateSchema("deliberationCompletedEventPayload", event.payload);
  if (
    !validation.valid ||
    event.projectId !== input.policy.projectId ||
    event.actor.kind !== "system"
  ) {
    return {
      status: "invalid",
      outcome: null,
      completedEventId: event.eventId,
      reasonCode: "deliberation_outcome_event_invalid",
    };
  }
  const payload = event.payload as DeliberationCompletedEventPayload;
  const valid = outcomeCandidates({ ...input, event, payload }).filter((outcome) => {
    try {
      validateDeliberationOutcome({ ...input, outcome });
      return true;
    } catch {
      return false;
    }
  });
  return valid.length === 1
    ? {
        status: "complete",
        outcome: structuredClone(valid[0]!),
        completedEventId: event.eventId,
        reasonCode: null,
      }
    : {
        status: "invalid",
        outcome: null,
        completedEventId: event.eventId,
        reasonCode: "deliberation_outcome_event_invalid",
      };
}
