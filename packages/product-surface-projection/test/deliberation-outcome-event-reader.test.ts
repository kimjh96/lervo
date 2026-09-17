import type { DeliberationOutcome, EventEnvelope } from "@lervo/schemas";
import { describe, expect, it } from "vitest";

import { convergedHistory, outcome, policy } from "../../deliberation/test/fixtures.js";
import { readDeliberationOutcomeEvent } from "../src/index.js";

const hash = (value: string) => `sha256:${value.repeat(64)}`;

function completedEvent(result: DeliberationOutcome): EventEnvelope {
  return {
    eventId: "evt_completed01",
    projectId: result.projectId,
    runId: "run_deliberation_control",
    sessionId: "ses_deliberation_control",
    seq: 10,
    type: "deliberation.completed",
    occurredAt: result.completedAt,
    actor: { kind: "system" },
    schemaVersion: 1,
    policyVersion: hash("5"),
    payload: {
      deliberationId: result.deliberationId,
      outcomeId: result.outcomeId,
      status: result.status,
      lastRound: result.lastRound,
      decisionArtifactId: result.decisionArtifactId,
      unresolvedBlockingObjectionIds: result.unresolvedBlockingObjectionIds,
      failurePhase: result.status === "failed" ? result.failure.phase : null,
      failureCode: result.status === "failed" ? result.failure.code : null,
    },
    previousHash: hash("6"),
    eventHash: hash("7"),
  };
}

describe("deliberation terminal-outcome event reader", () => {
  it("reconstructs and validates the exact converged outcome from canonical evidence", () => {
    const history = convergedHistory();
    const decision = history.artifacts.at(-1)!;
    const result = outcome({
      artifacts: history.artifacts,
      status: "converged",
      decisionArtifactId: decision.deliberationArtifactId,
      passedVerificationArtifactIds: history.artifacts
        .filter((artifact) => artifact.kind === "verification")
        .map((artifact) => artifact.deliberationArtifactId),
    });

    expect(
      readDeliberationOutcomeEvent({
        deliberationId: result.deliberationId,
        policy,
        artifacts: history.artifacts,
        verificationEvidence: [history.evidence],
        events: [completedEvent(result)],
      }),
    ).toEqual({
      status: "complete",
      outcome: result,
      completedEventId: "evt_completed01",
      reasonCode: null,
    });
  });

  it("keeps a history without a terminal event active", () => {
    const history = convergedHistory();

    expect(
      readDeliberationOutcomeEvent({
        deliberationId: "dlb_architecture_0001",
        policy,
        artifacts: history.artifacts,
        verificationEvidence: [history.evidence],
        events: [],
      }),
    ).toEqual({ status: "active", outcome: null, completedEventId: null, reasonCode: null });
  });

  it("rejects a terminal event whose outcome identity does not match the evidence", () => {
    const history = convergedHistory();
    const decision = history.artifacts.at(-1)!;
    const result = outcome({
      artifacts: history.artifacts,
      status: "converged",
      decisionArtifactId: decision.deliberationArtifactId,
      passedVerificationArtifactIds: history.artifacts
        .filter((artifact) => artifact.kind === "verification")
        .map((artifact) => artifact.deliberationArtifactId),
    });
    const event = completedEvent(result);

    expect(
      readDeliberationOutcomeEvent({
        deliberationId: result.deliberationId,
        policy,
        artifacts: history.artifacts,
        verificationEvidence: [history.evidence],
        events: [
          {
            ...event,
            payload: { ...event.payload, outcomeId: "dlo_1111111111111111" },
          },
        ],
      }),
    ).toEqual({
      status: "invalid",
      outcome: null,
      completedEventId: "evt_completed01",
      reasonCode: "deliberation_outcome_event_invalid",
    });
  });
});
