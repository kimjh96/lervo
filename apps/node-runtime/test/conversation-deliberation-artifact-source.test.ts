import { createHash } from "node:crypto";
import { resolve } from "node:path";

import type { ConversationApplication } from "@lervo/conversation-app";
import { FileSystemCas } from "@lervo/cas";
import type { ConversationInboundEvent, DeliberationArtifact, EventEnvelope } from "@lervo/schemas";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ConversationDeliberationArtifactSource } from "../src/conversation-deliberation-artifact-source.js";
import { FileConversationEventCursor } from "../src/conversation-event-cursor.js";
import { removeTemporaryRoots, temporaryRoot } from "./fixture.js";

const projectId = "prj_node_runtime_01";
const deliberationId = "dlb_discord_artifact01";
const digest = (value: string) => `sha256:${value.repeat(64)}`;
const artifactBody =
  "이 설계는 대화 채널에서 각 관점의 제안과 반론을 직접 읽고, 마지막 합의안을 같은 대화에서 받도록 구성해야 합니다.";
const artifactContentHash = `sha256:${createHash("sha256").update(artifactBody).digest("hex")}`;

afterEach(removeTemporaryRoots);

function artifact(): DeliberationArtifact {
  return {
    schemaVersion: 1,
    deliberationArtifactId: "dla_0123456789abcdef",
    deliberationId,
    projectId,
    policyId: "deliberation_discord-artifact",
    policyHash: digest("1"),
    kind: "proposal",
    round: 1,
    producer: {
      roleId: "architect",
      runId: "run_discord_artifact01",
      sessionId: "ses_discord_artifact01",
      provider: "codex",
    },
    content: {
      artifactId: `art_${artifactContentHash.slice("sha256:".length)}`,
      uri: `lervo-cas://sha256/${artifactContentHash.slice("sha256:".length)}`,
      mediaType: "text/markdown; charset=utf-8",
      contentHash: artifactContentHash,
      byteCount: Buffer.byteLength(artifactBody, "utf8"),
    },
    inputContext: {
      contextGeneration: 0,
      sharedContextIds: [],
      loadedReceiptIds: ["ctx_discord_loaded01"],
      injectedReceiptIds: ["ctx_discord_injected01"],
    },
    previousArtifactIds: [],
    evidenceEventIds: ["evt_discord_evidence01"],
    writingPublicationPermit: {
      schemaVersion: 1,
      permitId: "wpp_0123456789abcdef",
      surface: "documentation",
      artifactId: `art_${artifactContentHash.slice("sha256:".length)}`,
      contentHash: artifactContentHash,
      writingPolicyId: "writing_en-human",
      writingPolicyHash: digest("2"),
      evaluationId: "wre_01234567",
      evaluationHash: digest("3"),
      issuedAt: "2026-09-17T00:00:00.000Z",
    },
    details: {
      claims: [
        { claimId: "clm_0123456789abcdef", claimDigest: digest("4") },
        { claimId: "clm_1123456789abcdef", claimDigest: digest("5") },
      ],
    },
    createdAt: "2026-09-17T00:00:01.000Z",
  };
}

function repositoryEvent(seq: number, value?: DeliberationArtifact): EventEnvelope {
  if (value === undefined) {
    return {
      schemaVersion: 1,
      eventId: `evt_repository_${seq}`,
      projectId,
      runId: "run_repository_source01",
      sessionId: "ses_repository_source01",
      seq,
      type: "run.requested",
      occurredAt: "2026-09-17T00:00:00.000Z",
      actor: { kind: "system" },
      policyVersion: digest("6"),
      payload: {},
      previousHash: null,
      eventHash: digest("7"),
    } as EventEnvelope;
  }
  return {
    schemaVersion: 1,
    eventId: "evt_discord_artifact01",
    projectId,
    runId: value.producer.runId,
    sessionId: value.producer.sessionId,
    seq,
    type: "deliberation.artifact.recorded",
    occurredAt: value.createdAt,
    actor: { kind: "agent", provider: value.producer.provider },
    policyVersion: digest("8"),
    payload: {
      deliberationId: value.deliberationId,
      deliberationArtifactId: value.deliberationArtifactId,
      kind: value.kind,
      round: value.round,
      producerRoleId: value.producer.roleId,
      producerRoleName: "System architect",
      artifactId: value.content.artifactId,
      contentHash: value.content.contentHash,
      writingPermitId: value.writingPublicationPermit.permitId,
      artifact: value,
    },
    previousHash: digest("7"),
    eventHash: digest("9"),
  };
}

describe("conversation deliberation artifact source", () => {
  it("publishes each new writing-gated artifact into its exact origin thread once", async () => {
    const root = await temporaryRoot();
    const artifacts = await FileSystemCas.open(resolve(root, "artifacts"));
    const repositoryArtifacts = await FileSystemCas.open(resolve(root, "repository-artifacts"));
    await repositoryArtifacts.put(artifactBody);
    const events = [repositoryEvent(1)];
    const inbound: ConversationInboundEvent[] = [];
    const runDeliveryCycle = vi.fn(async () => ({ status: "idle" as const }));
    const application = {
      inspectDeliberationOrigin: vi.fn(async () => ({
        sourceEventId: `cve_${"a".repeat(64)}`,
        conversationId: "cnv_discord_origin01",
        threadId: "thd_discord_origin01",
        requesterParticipantId: "ptc_discord_requester01",
        originBindingDigest: digest("b"),
        responseLanguage: "ko",
      })),
      handleInboundEvent: vi.fn(async (event: ConversationInboundEvent) => {
        inbound.push(event);
        return [
          {
            policyId: "fixture",
            roleId: "fixture",
            result: { status: "completed", decision: {}, outbound: {} },
          },
        ];
      }),
      runDeliveryCycle,
    } as unknown as ConversationApplication;
    const cursorPath = resolve(root, "cursor.json");
    const createSource = () =>
      new ConversationDeliberationArtifactSource({
        projectId,
        integrationId: "itg_discord01",
        events: {
          latest: () => events.at(-1) ?? null,
          list: ({ afterSeq = 0, limit = 100 } = {}) =>
            events.filter((event) => event.seq > afterSeq).slice(0, limit),
        },
        repositoryArtifacts,
        conversationArtifacts: artifacts,
        cursor: new FileConversationEventCursor(cursorPath, {
          cursorKind: "deliberation.artifact",
          projectId,
          integrationId: "itg_discord01",
        }),
        now: () => new Date("2026-09-17T00:01:00.000Z"),
      });

    const source = createSource();
    await source.initialize();
    source.attach(application);
    events.push(repositoryEvent(2, artifact()));
    await expect(source.runCycle()).resolves.toEqual({ eventCount: 1, publicationCount: 1 });
    await expect(source.runCycle()).resolves.toEqual({ eventCount: 0, publicationCount: 0 });

    const restarted = createSource();
    restarted.attach(application);
    await expect(restarted.runCycle()).resolves.toEqual({ eventCount: 0, publicationCount: 0 });
    await expect(
      new FileConversationEventCursor(cursorPath, {
        cursorKind: "repository.signal",
        projectId,
        integrationId: "itg_discord01",
      }).read(),
    ).rejects.toThrow(/cursor is invalid/);
    expect(inbound).toHaveLength(1);
    expect(inbound[0]).toMatchObject({
      kind: "signal.raised",
      signalCode: "deliberation.artifact.recorded",
      target: {
        integrationId: "itg_discord01",
        projectId,
        conversationId: "cnv_discord_origin01",
        threadId: "thd_discord_origin01",
      },
      replyToEventId: `cve_${"a".repeat(64)}`,
      mentions: { roleIds: [], participantIds: [] },
    });
    const body = Buffer.from(
      await artifacts.get(
        `lervo-cas://sha256/${inbound[0]!.content.contentHash.slice("sha256:".length)}`,
      ),
    ).toString("utf8");
    expect(body).toBe(`**System architect**\n\n${artifactBody}`);
    expect(body).not.toContain("토론 1회차");
    expect(body).not.toContain("주장: 2개");
    expect(body).not.toContain(artifact().content.contentHash);
    expect(runDeliveryCycle).toHaveBeenCalledOnce();
  });
});
