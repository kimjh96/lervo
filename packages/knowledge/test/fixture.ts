import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { FileSystemCas } from "@lervo/cas";
import { SQLiteEventStore } from "@lervo/event-store-sqlite";
import type { DeliberationArtifact, DeliberationOutcome, EventEnvelope } from "@lervo/schemas";

import {
  convergedHistory,
  outcome,
  policy,
} from "../../deliberation/test/fixtures.js";
import { createKnowledgeCandidates } from "../src/index.js";

export const policyVersion =
  "sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd";
const roots: string[] = [];

export function sequence(prefix: string): () => string {
  let value = 0;
  return () => `${prefix}_${String(++value).padStart(8, "0")}`;
}

export async function stores() {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-knowledge-"));
  roots.push(root);
  return {
    events: await SQLiteEventStore.open({
      path: resolve(root, "events.sqlite"),
      projectId: policy.projectId,
    }),
    artifacts: await FileSystemCas.open(resolve(root, "cas")),
  };
}

export async function removeStores(): Promise<void> {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
}

function artifactRecordedPayload(artifact: DeliberationArtifact) {
  return {
    deliberationId: artifact.deliberationId,
    deliberationArtifactId: artifact.deliberationArtifactId,
    kind: artifact.kind,
    round: artifact.round,
    producerRoleId: artifact.producer.roleId,
    artifactId: artifact.content.artifactId,
    contentHash: artifact.content.contentHash,
    writingPermitId: artifact.writingPublicationPermit.permitId,
  };
}

export function seedConvergedEvents(input: {
  events: SQLiteEventStore;
  artifacts: readonly DeliberationArtifact[];
  result: Extract<DeliberationOutcome, { status: "converged" }>;
}): EventEnvelope {
  const evidenceIds = [...new Set(input.artifacts.flatMap((artifact) =>
    artifact.evidenceEventIds))];
  for (const [index, eventId] of evidenceIds.entries()) {
    input.events.append({
      eventId,
      projectId: policy.projectId,
      runId: "run_knowledge_evidence",
      sessionId: "ses_knowledge_evidence",
      type: "run.requested",
      occurredAt: `2026-08-18T23:59:${String(index).padStart(2, "0")}Z`,
      actor: { kind: "system" },
      schemaVersion: 1,
      policyVersion,
      payload: {
        requestDigest: `sha256:${String(index).padStart(64, "0")}`,
        role: "knowledge_fixture",
        risk: "low",
      },
    });
  }
  for (const [index, artifact] of input.artifacts.entries()) {
    input.events.append({
      eventId: `evt_recorded_${String(index).padStart(8, "0")}`,
      projectId: policy.projectId,
      runId: artifact.producer.runId,
      sessionId: artifact.producer.sessionId,
      type: "deliberation.artifact.recorded",
      occurredAt: artifact.createdAt,
      actor: { kind: "agent", provider: artifact.producer.provider },
      schemaVersion: 1,
      policyVersion,
      payload: artifactRecordedPayload(artifact),
    });
  }
  const decision = input.artifacts.at(-1)!;
  return input.events.append({
    eventId: "evt_knowledge_outcome",
    projectId: policy.projectId,
    runId: "run_knowledge_control",
    sessionId: "ses_knowledge_control",
    type: "deliberation.completed",
    occurredAt: input.result.completedAt,
    actor: { kind: "system" },
    schemaVersion: 1,
    policyVersion,
    payload: {
      deliberationId: input.result.deliberationId,
      outcomeId: input.result.outcomeId,
      status: input.result.status,
      lastRound: input.result.lastRound,
      decisionArtifactId: decision.deliberationArtifactId,
      unresolvedBlockingObjectionIds: [],
      failurePhase: null,
      failureCode: null,
    },
  }).event;
}

export async function createCandidateFixture(input?: { conflicts?: readonly string[] }) {
  const storage = await stores();
  const history = convergedHistory();
  const decision = history.artifacts.at(-1)!;
  await storage.artifacts.put("decision:lead:2:6");
  const result = outcome({
    artifacts: history.artifacts,
    status: "converged",
    decisionArtifactId: decision.deliberationArtifactId,
    passedVerificationArtifactIds: history.artifacts
      .filter((artifact) => artifact.kind === "verification")
      .map((artifact) => artifact.deliberationArtifactId),
  }) as Extract<DeliberationOutcome, { status: "converged" }>;
  const outcomeEvent = seedConvergedEvents({
    events: storage.events,
    artifacts: history.artifacts,
    result,
  });
  const [created] = await createKnowledgeCandidates({
    deliberationId: result.deliberationId,
    policy,
    artifacts: history.artifacts,
    verificationEvidence: [history.evidence],
    outcome: result,
    outcomeEvent,
    pathsByClaimId: { clm_architecture_0001: ["src/decision.ts"] },
    reviewIntervalDays: 30,
    conflictCandidateIdsByClaimId: {
      clm_architecture_0001: input?.conflicts ?? [],
    },
    policyVersion,
    events: storage.events,
    artifactStore: storage.artifacts,
    createEventId: sequence("evt_candidate"),
  });
  if (created === undefined) throw new Error("knowledge candidate fixture missing");
  return { storage, history, decision, result, outcomeEvent, created };
}
