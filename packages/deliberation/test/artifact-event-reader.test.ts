import type { DeliberationArtifact, EventEnvelope } from "@lervo/schemas";
import { describe, expect, it } from "vitest";

import { readDeliberationArtifactEvents } from "../src/index.js";

const projectId = "prj_deliberation_surface";
const deliberationId = "dlb_deliberation_surface";
const hash = (value: string) => `sha256:${value.repeat(64)}`;

function artifact(): DeliberationArtifact {
  return {
    schemaVersion: 1,
    deliberationArtifactId: "dla_0123456789abcdef",
    deliberationId,
    projectId,
    policyId: "deliberation_product_surface",
    policyHash: hash("1"),
    kind: "proposal",
    round: 1,
    producer: {
      roleId: "architect",
      runId: "run_deliberation_surface",
      sessionId: "ses_deliberation_surface",
      provider: "codex",
    },
    content: {
      artifactId: `art_${"a".repeat(64)}`,
      uri: `lervo-cas://sha256/${"a".repeat(64)}`,
      mediaType: "text/markdown; charset=utf-8",
      contentHash: hash("a"),
      byteCount: 120,
    },
    inputContext: {
      contextGeneration: 0,
      sharedContextIds: [],
      loadedReceiptIds: ["ctx_deliberation_loaded"],
      injectedReceiptIds: ["ctx_deliberation_injected"],
    },
    previousArtifactIds: [],
    evidenceEventIds: ["evt_evidence01"],
    writingPublicationPermit: {
      schemaVersion: 1,
      permitId: "wpp_0123456789abcdef",
      surface: "documentation",
      artifactId: `art_${"a".repeat(64)}`,
      contentHash: hash("a"),
      writingPolicyId: "writing_en-human",
      writingPolicyHash: hash("2"),
      evaluationId: "wre_01234567",
      evaluationHash: hash("3"),
      issuedAt: "2026-09-17T00:00:00.000Z",
    },
    details: {
      claims: [{ claimId: "clm_0123456789abcdef", claimDigest: hash("4") }],
    },
    createdAt: "2026-09-17T00:00:01.000Z",
  };
}

function recordedEvent(value = artifact()): EventEnvelope {
  return {
    eventId: "evt_recorded01",
    projectId,
    runId: value.producer.runId,
    sessionId: value.producer.sessionId,
    seq: 1,
    type: "deliberation.artifact.recorded",
    occurredAt: value.createdAt,
    actor: { kind: "agent", provider: value.producer.provider },
    schemaVersion: 1,
    policyVersion: hash("5"),
    payload: {
      deliberationId,
      deliberationArtifactId: value.deliberationArtifactId,
      kind: value.kind,
      round: value.round,
      producerRoleId: value.producer.roleId,
      artifactId: value.content.artifactId,
      contentHash: value.content.contentHash,
      writingPermitId: value.writingPublicationPermit.permitId,
      artifact: value,
    },
    previousHash: null,
    eventHash: hash("6"),
  };
}

describe("deliberation structured-artifact event reader", () => {
  it("returns complete source-bound artifacts without loading Markdown bodies", () => {
    const value = artifact();
    const result = readDeliberationArtifactEvents({
      deliberationId,
      events: [recordedEvent(value)],
    });

    expect(result).toEqual({
      status: "complete",
      artifacts: [value],
      artifactEventIds: ["evt_recorded01"],
      missingArtifactEventIds: [],
      invalidArtifactEventIds: [],
      reasonCode: null,
    });
  });

  it("reports a legacy summary-only event as unavailable instead of returning partial history", () => {
    const event = recordedEvent();
    const { artifact: _artifact, ...legacyPayload } = event.payload;

    expect(
      readDeliberationArtifactEvents({
        deliberationId,
        events: [{ ...event, payload: legacyPayload }],
      }),
    ).toEqual({
      status: "unavailable",
      artifacts: null,
      artifactEventIds: ["evt_recorded01"],
      missingArtifactEventIds: ["evt_recorded01"],
      invalidArtifactEventIds: [],
      reasonCode: "deliberation_structured_artifact_unavailable",
    });
  });

  it("reports contradictory event and artifact coordinates as invalid", () => {
    const event = recordedEvent();

    expect(
      readDeliberationArtifactEvents({
        deliberationId,
        events: [{ ...event, runId: "run_contradictory_surface" }],
      }),
    ).toMatchObject({
      status: "invalid",
      artifacts: null,
      invalidArtifactEventIds: ["evt_recorded01"],
      reasonCode: "deliberation_structured_artifact_invalid",
    });
  });
});
