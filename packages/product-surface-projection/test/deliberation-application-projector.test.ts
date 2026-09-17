import type { DeliberationArtifact, DeliberationOutcome, EventEnvelope } from "@lervo/schemas";
import { verificationResultBytes } from "@lervo/verification-contract";
import { describe, expect, it } from "vitest";

import { convergedHistory, outcome, policy } from "../../deliberation/test/fixtures.js";
import { projectDeliberationApplicationView } from "../src/index.js";

const hash = (value: string) => `sha256:${value.repeat(64)}`;

function artifactEvent(artifact: DeliberationArtifact, seq: number): EventEnvelope {
  return {
    eventId: `evt_artifact_${String(seq).padStart(8, "0")}`,
    projectId: artifact.projectId,
    runId: artifact.producer.runId,
    sessionId: artifact.producer.sessionId,
    seq,
    type: "deliberation.artifact.recorded",
    occurredAt: artifact.createdAt,
    actor: { kind: "agent", provider: artifact.producer.provider },
    schemaVersion: 1,
    policyVersion: hash("1"),
    payload: {
      deliberationId: artifact.deliberationId,
      deliberationArtifactId: artifact.deliberationArtifactId,
      kind: artifact.kind,
      round: artifact.round,
      producerRoleId: artifact.producer.roleId,
      artifactId: artifact.content.artifactId,
      contentHash: artifact.content.contentHash,
      writingPermitId: artifact.writingPublicationPermit.permitId,
      artifact,
    },
    previousHash: seq === 1 ? null : hash("2"),
    eventHash: hash("3"),
  };
}

function verificationEvent(
  artifact: Extract<DeliberationArtifact, { kind: "verification" }>,
  result: ReturnType<typeof convergedHistory>["evidence"]["result"],
): EventEnvelope {
  return {
    eventId: "evt_verification_complete",
    projectId: artifact.projectId,
    runId: artifact.producer.runId,
    sessionId: artifact.producer.sessionId,
    seq: 20,
    type: "verification.completed",
    occurredAt: result.completedAt,
    actor: { kind: "system" },
    schemaVersion: 1,
    policyVersion: hash("4"),
    payload: {
      verificationId: result.verificationId,
      suiteId: result.suiteId,
      suiteHash: result.suiteHash,
      repositoryRevision: result.repositoryRevision,
      status: result.status,
      resultArtifactId: artifact.details.resultArtifactId,
      resultContentHash: artifact.details.resultHash,
      nonPassedCommandIds: [],
    },
    previousHash: hash("5"),
    eventHash: hash("6"),
  };
}

function completedEvent(result: DeliberationOutcome): EventEnvelope {
  return {
    eventId: "evt_deliberation_complete",
    projectId: result.projectId,
    runId: "run_deliberation_control",
    sessionId: "ses_deliberation_control",
    seq: 21,
    type: "deliberation.completed",
    occurredAt: result.completedAt,
    actor: { kind: "system" },
    schemaVersion: 1,
    policyVersion: hash("7"),
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
    previousHash: hash("8"),
    eventHash: hash("9"),
  };
}

describe("deliberation application projector", () => {
  it("joins structured history, verification evidence, outcome, and product coordinates", async () => {
    const history = convergedHistory();
    const verification = history.artifacts.find(
      (artifact): artifact is Extract<DeliberationArtifact, { kind: "verification" }> =>
        artifact.kind === "verification",
    )!;
    const decision = history.artifacts.at(-1)!;
    const result = outcome({
      artifacts: history.artifacts,
      status: "converged",
      decisionArtifactId: decision.deliberationArtifactId,
      passedVerificationArtifactIds: [verification.deliberationArtifactId],
    });
    const events = [
      ...history.artifacts.map(artifactEvent),
      verificationEvent(verification, history.evidence.result),
      completedEvent(result),
    ];

    const view = await projectDeliberationApplicationView({
      deliberationId: result.deliberationId,
      projectId: result.projectId,
      status: "converged",
      policy,
      origin: {
        sourceEventId: `cve_${"a".repeat(64)}`,
        conversationId: "cnv_deliberation_surface",
        threadId: "thd_deliberation_surface",
        requesterParticipantId: "ptc_deliberation_requester",
        originBindingDigest: hash("b"),
      },
      events,
      readArtifact: async () => verificationResultBytes(history.evidence.result),
      loadVerificationSuite: async () => history.evidence.suite,
      sourceEventHeadHash: hash("c"),
      repositoryRevision: hash("d"),
      resourceReportCoordinate: "resource:deliberation",
      publicationCoordinate: "publication:deliberation",
      originDeliveryCoordinate: "delivery:deliberation",
    });

    expect(view).toMatchObject({
      status: "converged",
      projectionStatus: "complete",
      projectionReasonCode: null,
      artifacts: { length: history.artifacts.length },
      verifications: [
        { status: "passed", resultHash: history.evidence.resultArtifact.contentHash },
      ],
    });
  });

  it("surfaces a legacy summary-only artifact source as unavailable", async () => {
    const history = convergedHistory();
    const event = artifactEvent(history.artifacts[0]!, 1);
    const { artifact: _artifact, ...payload } = event.payload;

    const view = await projectDeliberationApplicationView({
      deliberationId: "dlb_architecture_0001",
      projectId: policy.projectId,
      status: "running",
      policy,
      origin: {
        sourceEventId: `cve_${"a".repeat(64)}`,
        conversationId: "cnv_deliberation_surface",
        threadId: null,
        requesterParticipantId: "ptc_deliberation_requester",
        originBindingDigest: hash("b"),
      },
      events: [{ ...event, payload }],
      readArtifact: async () => new Uint8Array(),
      loadVerificationSuite: async () => history.evidence.suite,
      sourceEventHeadHash: hash("c"),
      repositoryRevision: hash("d"),
      resourceReportCoordinate: null,
      publicationCoordinate: null,
      originDeliveryCoordinate: null,
    });

    expect(view).toMatchObject({
      artifacts: [],
      projectionStatus: "unavailable",
      projectionReasonCode: "deliberation_structured_artifact_unavailable",
    });
  });
});
