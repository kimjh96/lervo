import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { FileSystemCas } from "@lervo/cas";
import { SQLiteEventStore } from "@lervo/event-store-sqlite";
import { createDoctorReport } from "@lervo/diagnostics";
import type { DeliberationArtifact, DeliberationOutcome, EventEnvelope } from "@lervo/schemas";
import { afterEach, describe, expect, it } from "vitest";

import {
  convergedHistory,
  objectionId,
  outcome,
  policy,
} from "../../deliberation/test/fixtures.js";
import {
  createKnowledgeCandidates,
  knowledgeCandidateBytes,
} from "../src/index.js";

const policyVersion = "sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd";
const roots: string[] = [];

function sequence(prefix: string): () => string {
  let value = 0;
  return () => `${prefix}_${String(++value).padStart(8, "0")}`;
}

async function stores() {
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

function seedConvergedEvents(input: {
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

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("knowledge candidate creation", () => {
  it("creates one CAS-backed candidate per adopted claim from event-bound convergence", async () => {
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
      policyVersion,
      events: storage.events,
      artifactStore: storage.artifacts,
      createEventId: sequence("evt_candidate"),
    });
    if (created === undefined) throw new Error("knowledge candidate fixture missing");

    expect(created.candidate).toMatchObject({
      status: "candidate",
      source: {
        kind: "converged_deliberation",
        outcomeId: result.outcomeId,
        decisionArtifactId: decision.deliberationArtifactId,
      },
      paths: ["src/decision.ts"],
      verifiedRevision: history.evidence.result.repositoryRevision,
    });
    const bytes = await storage.artifacts.get(created!.candidateArtifact.uri);
    expect(bytes).toEqual(knowledgeCandidateBytes(created!.candidate));
    expect(created.recordedEvent.payload).toMatchObject({
      candidateId: created.candidate.candidateId,
      sourceOutcomeId: result.outcomeId,
      candidateContentHash: created.candidateArtifact.contentHash,
    });
    expect(JSON.stringify(storage.events.list())).not.toContain("decision:lead:2:6");
    expect(storage.events.verifyIntegrity().valid).toBe(true);
    await expect(createDoctorReport({
      projectId: policy.projectId,
      events: storage.events,
      artifacts: storage.artifacts,
    })).resolves.toMatchObject({ status: "healthy", issues: [] });

    await expect(createKnowledgeCandidates({
      deliberationId: result.deliberationId,
      policy,
      artifacts: history.artifacts,
      verificationEvidence: [history.evidence],
      outcome: result,
      outcomeEvent,
      pathsByClaimId: { clm_architecture_0001: ["src/decision.ts"] },
      reviewIntervalDays: 30,
      policyVersion,
      events: storage.events,
      artifactStore: storage.artifacts,
      createEventId: sequence("evt_duplicate"),
    })).rejects.toMatchObject({
      code: "candidate_contract_invalid",
      reason: "candidate_already_recorded",
    });
    storage.events.close();
  });

  it.each(["no_consensus", "failed"] as const)(
    "does not turn a %s outcome into a knowledge candidate",
    async (status) => {
      const storage = await stores();
      const history = convergedHistory();
      const artifacts = status === "no_consensus" ? history.artifacts.slice(0, 2) : [];
      const result = outcome({
        artifacts,
        status,
        ...(status === "no_consensus"
          ? {
              reason: "blocking_objections_unresolved" as const,
              unresolvedBlockingObjectionIds: [objectionId],
            }
          : {}),
      });

      await expect(createKnowledgeCandidates({
        deliberationId: result.deliberationId,
        policy,
        artifacts,
        verificationEvidence: [],
        outcome: result,
        outcomeEvent: {} as EventEnvelope,
        pathsByClaimId: {},
        reviewIntervalDays: 30,
        policyVersion,
        events: storage.events,
        artifactStore: storage.artifacts,
        createEventId: sequence("evt_ineligible"),
      })).rejects.toMatchObject({
        code: "candidate_not_eligible",
        reason: "outcome_not_converged",
      });
      expect(storage.events.list()).toEqual([]);
      storage.events.close();
    },
  );
});
