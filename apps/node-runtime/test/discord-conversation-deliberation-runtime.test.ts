import { createHash } from "node:crypto";

import type { ConversationApplication } from "@lervo/conversation-app";
import {
  createConversationInboundEvent,
  hashConversationSourceEventKey,
} from "@lervo/conversation-contract";
import type { ConversationDeliberationPort } from "@lervo/conversation-control";
import type { ArtifactStore } from "@lervo/storage-contract";
import { describe, expect, it, vi } from "vitest";

import { DiscordConversationDeliberationRuntime } from "../src/discord-conversation-deliberation-runtime.js";
import type { ConversationDeliberationParticipantAssignmentPort } from "../src/conversation-deliberation-participant-router.js";

function artifacts(): ArtifactStore {
  const values = new Map<string, Uint8Array>();
  const put: ArtifactStore["put"] = async (content) => {
    const bytes = typeof content === "string" ? new TextEncoder().encode(content) : content;
    const contentHash = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
    const uri = `lervo-cas://sha256/${contentHash.slice(7)}`;
    values.set(uri, bytes);
    return { uri, contentHash, byteCount: bytes.byteLength, created: true };
  };
  return {
    put,
    putStream: async (chunks) => {
      const collected: Uint8Array[] = [];
      for await (const chunk of chunks) {
        collected.push(typeof chunk === "string" ? new TextEncoder().encode(chunk) : chunk);
      }
      return put(Buffer.concat(collected));
    },
    get: async (uri) => values.get(uri)!,
    has: async (uri) => values.has(uri),
  };
}

function participantAssignments(
  participantIds: string[],
): ConversationDeliberationParticipantAssignmentPort {
  return {
    preflight: () => ({ participantIds }),
    assign: () => [],
    attach: () => () => undefined,
    publish: async () => undefined,
  };
}

describe("Discord conversation deliberation runtime", () => {
  it("starts the configured policy from a natural-language surface effect", async () => {
    const artifactStore = artifacts();
    const start = vi.fn<ConversationDeliberationPort["start"]>(async () => ({
      deliberationId: "dlb_natural0001",
      status: "running",
      artifactCount: 0,
      nextAction: "wait",
    }));
    const runtime = await DiscordConversationDeliberationRuntime.open({
      config: {
        cliExecutable: process.execPath,
        workerId: "test-worker",
        defaultPolicyId: "deliberation_architecture-review",
        principals: [],
      },
      integrationId: "itg_discord01",
      projectId: "prj_control01",
      repositoryRoot: process.cwd(),
      dataDirectory: process.cwd(),
      artifactStore,
      repositoryArtifactStore: artifactStore,
      participantAssignments: participantAssignments(["ptc_reviewer01", "ptc_reviewer02"]),
      onFailure: vi.fn(),
    });
    const deliberations: ConversationDeliberationPort = {
      start,
      resume: vi.fn(),
      inspect: vi.fn(),
    };
    const application = {
      deliberations,
      runDeliberationWorkerCycle: async () => ({ status: "idle" as const }),
      runDeliberationResumeWorkerCycle: async () => ({ status: "idle" as const }),
    } as unknown as ConversationApplication;
    runtime.attach(application, 1_000);
    const topic = "저장소 지식 충돌 전략을 이해관계자별로 검토한다.";
    const request = "이 설계를 이해관계자별로 다시 검토하고 최종 결론을 내려줘.";
    const source = await artifactStore.put(request);
    const event = createConversationInboundEvent({
      sourceEventKeyHash: hashConversationSourceEventKey("natural-deliberation"),
      target: {
        integrationId: "itg_discord01",
        projectId: "prj_control01",
        conversationId: "cnv_operator01",
        threadId: null,
      },
      kind: "message.created",
      actor: { kind: "human", participantId: "ptc_operator01", roleId: null },
      mentions: { participantIds: [], roleIds: [] },
      content: {
        artifactId: "art_natural0001",
        contentHash: source.contentHash,
        byteCount: source.byteCount,
        mediaType: "text/plain; charset=utf-8",
      },
      replyToEventId: null,
      signalCode: null,
      automationDepth: 0,
      occurredAt: "2026-09-16T00:00:00.000Z",
    });

    const response = await runtime.actionResponder.respond(
      {
        event,
        context: {
          priorTurns: [
            {
              role: "user",
              text: "Paperclip, Buzz, Prime Agent, Hermes의 장점을 Lervo 코어 위에 통합한다.",
              speaker: {
                kind: "human",
                participantId: "ptc_operator01",
                agentId: null,
                roleId: null,
              },
            },
          ],
        },
      } as never,
      { kind: "deliberation_start", specification: topic },
      { effectRequesterAuthorized: true },
    );

    expect(runtime.naturalLanguageEffect?.effectId).toBe("deliberation_start");
    expect(start).toHaveBeenCalledWith(
      expect.objectContaining({
        event,
        policyId: "deliberation_architecture-review",
        topic: expect.stringContaining(`Current human request:\n${request}`),
        requestedAt: expect.any(String),
      }),
    );
    expect(start.mock.calls[0]![0].topic).toContain(topic);
    expect(start.mock.calls[0]![0].topic).toContain("Paperclip, Buzz, Prime Agent, Hermes");
    const content = new TextDecoder().decode(
      await artifactStore.get(
        `lervo-cas://sha256/${response.content.contentHash.slice("sha256:".length)}`,
      ),
    );
    expect(content).toContain("이해관계자별 독립 검토를 시작했습니다");
    expect(content).not.toContain("dlb_natural0001");
    expect(content).not.toContain("0 artifacts");
    expect(content).not.toContain("Wait for");
    expect(response.deliveryRelation).toBe("reply");
    expect(response.audienceParticipation).toBe("observe_only");
    await runtime.stop();
  });

  it("does not spend a provider call when fewer than two real participants are verified", async () => {
    const artifactStore = artifacts();
    const start = vi.fn<ConversationDeliberationPort["start"]>();
    const runtime = await DiscordConversationDeliberationRuntime.open({
      config: {
        cliExecutable: process.execPath,
        workerId: "test-worker",
        defaultPolicyId: "deliberation_architecture-review",
        principals: [],
      },
      integrationId: "itg_discord01",
      projectId: "prj_control01",
      repositoryRoot: process.cwd(),
      dataDirectory: process.cwd(),
      artifactStore,
      repositoryArtifactStore: artifactStore,
      participantAssignments: participantAssignments(["ptc_reviewer01"]),
      onFailure: vi.fn(),
    });
    runtime.attach(
      {
        deliberations: { start, resume: vi.fn(), inspect: vi.fn() },
        runDeliberationWorkerCycle: async () => ({ status: "idle" as const }),
        runDeliberationResumeWorkerCycle: async () => ({ status: "idle" as const }),
      } as unknown as ConversationApplication,
      1_000,
    );
    const source = await artifactStore.put("이 주제를 여러 에이전트가 토론해줘.");
    const event = createConversationInboundEvent({
      sourceEventKeyHash: hashConversationSourceEventKey("insufficient-participants"),
      target: {
        integrationId: "itg_discord01",
        projectId: "prj_control01",
        conversationId: "cnv_operator01",
        threadId: null,
      },
      kind: "message.created",
      actor: { kind: "human", participantId: "ptc_operator01", roleId: null },
      mentions: { participantIds: [], roleIds: [] },
      content: {
        artifactId: "art_insufficient01",
        contentHash: source.contentHash,
        byteCount: source.byteCount,
        mediaType: "text/plain; charset=utf-8",
      },
      replyToEventId: null,
      signalCode: null,
      automationDepth: 0,
      occurredAt: "2026-09-18T00:00:00.000Z",
    });

    const response = await runtime.actionResponder.respond(
      { event } as never,
      { kind: "deliberation_start", specification: "실제 에이전트만 참여한다." },
      { effectRequesterAuthorized: true },
    );

    expect(start).not.toHaveBeenCalled();
    const content = new TextDecoder().decode(
      await artifactStore.get(
        `lervo-cas://sha256/${response.content.contentHash.slice("sha256:".length)}`,
      ),
    );
    expect(content).toContain("실제 에이전트가 2명 이상 확인되지 않아");
    expect(content).toContain("공급자 호출이나 부분 토론은 실행되지 않았습니다");
    await runtime.stop();
  });
});
