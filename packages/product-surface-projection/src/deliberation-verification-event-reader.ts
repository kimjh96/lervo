import { createHash } from "node:crypto";

import type { DeliberationVerificationEvidence } from "@lervo/deliberation";
import {
  type DeliberationArtifact,
  type EventEnvelope,
  type VerificationResult,
  type VerificationSuite,
  validateSchema,
} from "@lervo/schemas";

export type DeliberationVerificationEventReadResult =
  | {
      status: "complete";
      evidence: DeliberationVerificationEvidence[];
      verificationEventIds: string[];
      reasonCode: null;
    }
  | {
      status: "unavailable";
      evidence: null;
      verificationEventIds: string[];
      reasonCode: "deliberation_verification_evidence_unavailable";
    }
  | {
      status: "invalid";
      evidence: null;
      verificationEventIds: string[];
      reasonCode: "deliberation_verification_evidence_invalid";
    };

function sha256(bytes: Uint8Array): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

export async function readDeliberationVerificationEvents(input: {
  artifacts: readonly DeliberationArtifact[];
  events: readonly EventEnvelope[];
  readArtifact(uri: string): Promise<Uint8Array>;
  loadSuite(suiteId: string): Promise<VerificationSuite>;
}): Promise<DeliberationVerificationEventReadResult> {
  const verificationArtifacts = input.artifacts.filter(
    (artifact) => artifact.kind === "verification",
  );
  if (verificationArtifacts.length === 0) {
    return { status: "complete", evidence: [], verificationEventIds: [], reasonCode: null };
  }
  const evidence: DeliberationVerificationEvidence[] = [];
  const eventIds: string[] = [];
  for (const artifact of verificationArtifacts) {
    const matches = input.events.filter(
      (event) =>
        event.type === "verification.completed" &&
        event.payload.verificationId === artifact.details.verificationId,
    );
    if (matches.length === 0) {
      return {
        status: "unavailable",
        evidence: null,
        verificationEventIds: eventIds,
        reasonCode: "deliberation_verification_evidence_unavailable",
      };
    }
    if (matches.length !== 1) {
      return {
        status: "invalid",
        evidence: null,
        verificationEventIds: [...eventIds, ...matches.map((event) => event.eventId)],
        reasonCode: "deliberation_verification_evidence_invalid",
      };
    }
    const event = matches[0]!;
    eventIds.push(event.eventId);
    if (
      !validateSchema("verificationCompletedEventPayload", event.payload).valid ||
      event.projectId !== artifact.projectId ||
      event.runId !== artifact.producer.runId ||
      event.sessionId !== artifact.producer.sessionId ||
      event.payload.suiteId !== artifact.details.suiteId ||
      event.payload.resultArtifactId !== artifact.details.resultArtifactId ||
      event.payload.resultContentHash !== artifact.details.resultHash ||
      event.payload.status !== artifact.details.status
    ) {
      return {
        status: "invalid",
        evidence: null,
        verificationEventIds: eventIds,
        reasonCode: "deliberation_verification_evidence_invalid",
      };
    }
    const digest = artifact.details.resultHash.slice("sha256:".length);
    const uri = `lervo-cas://sha256/${digest}`;
    let bytes: Uint8Array;
    let suite: VerificationSuite;
    try {
      [bytes, suite] = await Promise.all([
        input.readArtifact(uri),
        input.loadSuite(artifact.details.suiteId),
      ]);
    } catch {
      return {
        status: "unavailable",
        evidence: null,
        verificationEventIds: eventIds,
        reasonCode: "deliberation_verification_evidence_unavailable",
      };
    }
    let result: VerificationResult;
    try {
      result = JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(bytes),
      ) as VerificationResult;
    } catch {
      return {
        status: "invalid",
        evidence: null,
        verificationEventIds: eventIds,
        reasonCode: "deliberation_verification_evidence_invalid",
      };
    }
    if (
      sha256(bytes) !== artifact.details.resultHash ||
      !validateSchema("verificationResult", result).valid ||
      result.verificationId !== artifact.details.verificationId ||
      result.suiteId !== artifact.details.suiteId ||
      result.status !== artifact.details.status ||
      suite.suiteId !== artifact.details.suiteId
    ) {
      return {
        status: "invalid",
        evidence: null,
        verificationEventIds: eventIds,
        reasonCode: "deliberation_verification_evidence_invalid",
      };
    }
    evidence.push({
      suite: structuredClone(suite),
      result,
      resultArtifact: {
        artifactId: artifact.details.resultArtifactId,
        uri,
        mediaType: "application/vnd.lervo.verification-result+json; charset=utf-8",
        contentHash: artifact.details.resultHash,
        byteCount: bytes.byteLength,
      },
    });
  }
  return {
    status: "complete",
    evidence,
    verificationEventIds: eventIds,
    reasonCode: null,
  };
}
