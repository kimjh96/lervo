import { rootWorkId } from "@lervo/execution-contract";
import { deliberationPolicyHash } from "@lervo/deliberation";
import type { ProjectStorage } from "@lervo/project-storage";
import type { DeliberationArtifact, DeliberationOutcome, EventEnvelope } from "@lervo/schemas";
import { verificationResultBytes } from "@lervo/verification-contract";
import { describe, expect, it, vi } from "vitest";

import { convergedHistory, outcome, policy } from "../../../packages/deliberation/test/fixtures.js";
import { inspectProductDeliberation } from "../src/product-deliberation-inspection.js";
import {
  listedEvents,
  longHistoryEvents,
  longHistoryHeadSeq,
} from "../../../packages/storage-contract/test/listed-event-source.fixture.js";

const deliberationId = "dlb_architecture_0001";
const integrationId = "itg_deliberation_surface";
const conversationEventId = `cve_${"a".repeat(64)}`;
const hash = (value: string) => `sha256:${value.repeat(64)}`;

function envelope(input: {
  seq: number;
  type: EventEnvelope["type"];
  runId: string;
  sessionId: string;
  occurredAt: string;
  actor: EventEnvelope["actor"];
  payload: Record<string, unknown>;
}): EventEnvelope {
  return {
    eventId: `evt_product_deliberation_${String(input.seq).padStart(4, "0")}`,
    projectId: policy.projectId,
    runId: input.runId,
    sessionId: input.sessionId,
    seq: input.seq,
    type: input.type,
    occurredAt: input.occurredAt,
    actor: input.actor,
    schemaVersion: input.type === "work.causality.recorded" ? 2 : 1,
    policyVersion: hash("1"),
    payload: input.payload,
    previousHash: input.seq === 1 ? null : hash("2"),
    eventHash: hash(String((input.seq % 9) + 1)),
  };
}

function artifactEvent(artifact: DeliberationArtifact, seq: number): EventEnvelope {
  return envelope({
    seq,
    type: "deliberation.artifact.recorded",
    runId: artifact.producer.runId,
    sessionId: artifact.producer.sessionId,
    occurredAt: artifact.createdAt,
    actor: { kind: "agent", provider: artifact.producer.provider },
    payload: {
      deliberationId,
      deliberationArtifactId: artifact.deliberationArtifactId,
      kind: artifact.kind,
      round: artifact.round,
      producerRoleId: artifact.producer.roleId,
      artifactId: artifact.content.artifactId,
      contentHash: artifact.content.contentHash,
      writingPermitId: artifact.writingPublicationPermit.permitId,
      artifact,
    },
  });
}

function completedEvent(result: DeliberationOutcome, seq: number): EventEnvelope {
  return envelope({
    seq,
    type: "deliberation.completed",
    runId: "run_deliberation_root",
    sessionId: "ses_deliberation_root",
    occurredAt: result.completedAt,
    actor: { kind: "system" },
    payload: {
      deliberationId,
      outcomeId: result.outcomeId,
      status: result.status,
      lastRound: result.lastRound,
      decisionArtifactId: result.decisionArtifactId,
      unresolvedBlockingObjectionIds: result.unresolvedBlockingObjectionIds,
      failurePhase: null,
      failureCode: null,
    },
  });
}

describe("installed product deliberation inspection", () => {
  it.each([
    { history: "short", longHistory: false },
    { history: "beyond 100,000 events", longHistory: true },
  ])(
    "joins queue, canonical policy, history, verification, resources, publication, and delivery ($history)",
    async ({ longHistory }) => {
      const history = convergedHistory();
      const verification = history.artifacts.find(
        (artifact): artifact is Extract<DeliberationArtifact, { kind: "verification" }> =>
          artifact.kind === "verification",
      )!;
      const result = outcome({
        artifacts: history.artifacts,
        status: "converged",
        decisionArtifactId: history.artifacts.at(-1)!.deliberationArtifactId,
        passedVerificationArtifactIds: [verification.deliberationArtifactId],
      });
      const workId = rootWorkId(policy.projectId, "run_deliberation_root");
      const sourceEvents: EventEnvelope[] = [
        envelope({
          seq: 1,
          type: "work.causality.recorded",
          runId: "run_deliberation_root",
          sessionId: "ses_deliberation_root",
          occurredAt: "2026-01-01T00:00:00.000Z",
          actor: { kind: "system" },
          payload: {
            workId,
            executionContractVersion: 1,
            relationship: "root",
            parentRunId: null,
            retryOfRunId: null,
            attemptOrdinal: 1,
            workstreamId: null,
            assignmentId: null,
            agentId: null,
          },
        }),
        envelope({
          seq: 2,
          type: "deliberation.started",
          runId: "run_deliberation_root",
          sessionId: "ses_deliberation_root",
          occurredAt: "2026-01-01T00:00:00.000Z",
          actor: { kind: "system" },
          payload: {
            deliberationId,
            policyId: policy.policyId,
            policyHash: deliberationPolicyHash(policy),
            participantRoleIds: policy.participants.map((participant) => participant.roleId),
            maxRounds: policy.maxRounds,
            policy,
          },
        }),
        ...history.artifacts.map((artifact, index) => artifactEvent(artifact, index + 3)),
        envelope({
          seq: history.artifacts.length + 3,
          type: "verification.completed",
          runId: verification.producer.runId,
          sessionId: verification.producer.sessionId,
          occurredAt: history.evidence.result.completedAt,
          actor: { kind: "system" },
          payload: {
            verificationId: history.evidence.result.verificationId,
            suiteId: history.evidence.result.suiteId,
            suiteHash: history.evidence.result.suiteHash,
            repositoryRevision: history.evidence.result.repositoryRevision,
            status: history.evidence.result.status,
            resultArtifactId: verification.details.resultArtifactId,
            resultContentHash: verification.details.resultHash,
            nonPassedCommandIds: [],
          },
        }),
        completedEvent(result, history.artifacts.length + 4),
      ].map((event, index, all) => ({
        ...event,
        seq: index + 1,
        previousHash: index === 0 ? null : all[index - 1]!.eventHash,
      }));
      const long = longHistory ? longHistoryEvents(sourceEvents) : null;
      const events = long?.events ?? sourceEvents;
      const headHash = events.at(-1)!.eventHash;
      const eventCount = long === null ? events.length : longHistoryHeadSeq;
      const close = vi.fn(async () => undefined);
      const storage = {
        manifest: { projectId: policy.projectId },
        paths: { data: "/repository/.lervo/data" },
        events: {
          verifyIntegrity: () => ({ valid: true, eventCount, headHash }),
          list: long?.list ?? listedEvents(events),
        },
        artifacts: {
          get: async () => verificationResultBytes(history.evidence.result),
        },
        close,
      } as unknown as ProjectStorage;
      const origin = {
        conversationId: "cnv_deliberation_surface",
        threadId: "thd_deliberation_surface",
        requesterParticipantId: "ptc_deliberation_requester",
        originBindingDigest: hash("b"),
      };
      const summary = {
        deliberationId,
        status: "converged" as const,
        artifactCount: history.artifacts.length,
        nextAction: "none" as const,
      };
      const queues = {
        start: {
          operation: "start" as const,
          projectId: policy.projectId,
          sourceEventId: conversationEventId,
          deliberationId,
          requestHash: hash("c"),
          principalHash: hash("d"),
          origin,
          policyId: policy.policyId,
          topic: "Choose an architecture.",
          requestedAt: "2026-01-01T00:00:00.000Z",
          state: "settled" as const,
          attemptCount: 1,
          leaseExpiresAt: null,
          summary,
          failureCode: null,
          reconciliation: null,
        },
        startNotification: {
          operation: "start" as const,
          projectId: policy.projectId,
          deliberationId,
          summary,
          occurredAt: result.completedAt,
          state: "accepted" as const,
          attemptCount: 1,
          leaseExpiresAt: null,
          conversationEventId,
          acceptedAt: result.completedAt,
        },
        resume: null,
        resumeNotification: null,
      };
      const deliveries = [
        {
          status: "delivered" as const,
          outbound: {
            schemaVersion: 1 as const,
            outboundId: "cvo_deliberation_surface",
            sourceEventId: conversationEventId,
            policyId: "cpl_deliberation_surface",
            target: { integrationId, projectId: policy.projectId, ...origin },
            actor: {
              kind: "agent" as const,
              participantId: "ptc_deliberation_agent",
              roleId: "role_deliberation_agent",
              agentBinding: null,
            },
            content: {
              artifactId: "art_deliberation_result",
              contentHash: hash("e"),
              byteCount: 20,
              mediaType: "text/plain; charset=utf-8" as const,
            },
            publicationPermit: {
              schemaVersion: 1 as const,
              permitId: "wpp_0123456789abcdef",
              surface: "chat" as const,
              artifactId: "art_deliberation_result",
              contentHash: hash("e"),
              writingPolicyId: "writing_en-human",
              writingPolicyHash: hash("f"),
              evaluationId: "wre_01234567",
              evaluationHash: hash("1"),
              issuedAt: result.completedAt,
            },
            deliveryRelation: "reply" as const,
            automationDepth: 1,
            createdAt: result.completedAt,
          },
          receipt: {
            schemaVersion: 1 as const,
            outboundId: "cvo_deliberation_surface",
            integrationId,
            deliveryKeyHash: hash("2"),
            deliveredAt: result.completedAt,
          },
        },
      ];

      const view = await inspectProductDeliberation(
        { repositoryRoot: "/repository", integrationId, deliberationId },
        {
          openStorage: async () => storage,
          captureSnapshot: async () => ({ revision: hash("3") }),
          inspectQueues: async () => queues,
          inspectDeliveries: async () => deliveries,
          loadVerificationSuite: async () => history.evidence.suite,
          policy: { loadCurrentPolicy: async () => policy },
        },
      );

      expect(view).toMatchObject({
        status: "converged",
        projectionStatus: "complete",
        resourceReportCoordinate: `work:${workId}`,
        publicationCoordinate: "writing-permit:wpp_0123456789abcdef",
        originDeliveryCoordinate: `conversation-delivery:${hash("2")}`,
        participants: expect.arrayContaining([
          expect.objectContaining({ disposition: "policy_only" }),
        ]),
      });
      expect(close).toHaveBeenCalledOnce();
    },
  );
});
