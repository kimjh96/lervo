import type { EventEnvelope } from "@lervo/schemas";
import { verificationResultBytes } from "@lervo/verification-contract";
import { describe, expect, it } from "vitest";

import { convergedHistory } from "../../deliberation/test/fixtures.js";
import { readDeliberationVerificationEvents } from "../src/index.js";

const hash = (value: string) => `sha256:${value.repeat(64)}`;

function fixture() {
  const history = convergedHistory();
  const artifact = history.artifacts.find((item) => item.kind === "verification")!;
  const event: EventEnvelope = {
    eventId: "evt_verification_complete",
    projectId: artifact.projectId,
    runId: artifact.producer.runId,
    sessionId: artifact.producer.sessionId,
    seq: 8,
    type: "verification.completed",
    occurredAt: history.evidence.result.completedAt,
    actor: { kind: "system" },
    schemaVersion: 1,
    policyVersion: hash("9"),
    payload: {
      verificationId: history.evidence.result.verificationId,
      suiteId: history.evidence.result.suiteId,
      suiteHash: history.evidence.result.suiteHash,
      repositoryRevision: history.evidence.result.repositoryRevision,
      status: history.evidence.result.status,
      resultArtifactId: history.evidence.resultArtifact.artifactId,
      resultContentHash: history.evidence.resultArtifact.contentHash,
      nonPassedCommandIds: [],
    },
    previousHash: hash("7"),
    eventHash: hash("8"),
  };
  return { history, artifact, event, bytes: verificationResultBytes(history.evidence.result) };
}

describe("deliberation verification-event reader", () => {
  it("reconstructs source-bound verification evidence from the canonical result artifact", async () => {
    const { history, event, bytes } = fixture();

    await expect(
      readDeliberationVerificationEvents({
        artifacts: history.artifacts,
        events: [event],
        readArtifact: async () => bytes,
        loadSuite: async () => history.evidence.suite,
      }),
    ).resolves.toEqual({
      status: "complete",
      evidence: [history.evidence],
      verificationEventIds: [event.eventId],
      reasonCode: null,
    });
  });

  it("reports a missing verification event as unavailable", async () => {
    const { history } = fixture();

    await expect(
      readDeliberationVerificationEvents({
        artifacts: history.artifacts,
        events: [],
        readArtifact: async () => new Uint8Array(),
        loadSuite: async () => history.evidence.suite,
      }),
    ).resolves.toMatchObject({
      status: "unavailable",
      reasonCode: "deliberation_verification_evidence_unavailable",
    });
  });

  it("rejects a verification event whose run differs from its deliberation artifact", async () => {
    const { history, event, bytes } = fixture();

    await expect(
      readDeliberationVerificationEvents({
        artifacts: history.artifacts,
        events: [{ ...event, runId: "run_wrong_verification" }],
        readArtifact: async () => bytes,
        loadSuite: async () => history.evidence.suite,
      }),
    ).resolves.toMatchObject({
      status: "invalid",
      reasonCode: "deliberation_verification_evidence_invalid",
    });
  });
});
