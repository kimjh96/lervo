import { resolve } from "node:path";

import { FileSystemCas } from "@lervo/cas";
import {
  createConversationInboundEvent,
  hashConversationSourceEventKey,
} from "@lervo/conversation-contract";
import type { ConversationInboundEvent, ConversationOutboundMessage } from "@lervo/schemas";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  CoResidentConversationPeerTurnRouter,
  registerConversationPeerTurnEndpoint,
} from "../src/conversation-peer-turn-router.js";
import type { DiscordPeerAgentBinding } from "../src/discord-conversation-composition.js";
import { removeTemporaryRoots, temporaryRoot } from "./fixture.js";

const conversationId = "cnv_peerturn01";
const projectId = "prj_peerturn01";

interface AgentFixture {
  integrationId: string;
  participantId: string;
  roleId: string;
  agentBinding: DiscordPeerAgentBinding["agentBinding"];
}

function agent(index: number, roleId: string): AgentFixture {
  return {
    integrationId: `itg_peerturn0${index}`,
    participantId: `ptc_peerturn0${index}`,
    roleId,
    agentBinding: {
      agentId: `agt_${String(index).repeat(24)}`,
      roleVersion: "1.0.0",
      roleContractHash: `sha256:${String(index + 1).repeat(64)}`,
      roleProfileHash: `sha256:${String(index + 2).repeat(64)}`,
    },
  };
}

function peer(value: AgentFixture): DiscordPeerAgentBinding {
  return {
    participantKeys: [`bot:${value.integrationId.slice(-1)}`],
    participantId: value.participantId,
    roleId: value.roleId,
    agentBinding: value.agentBinding,
    tenantKeys: ["123456789012345678"],
    conversationIds: [conversationId],
  };
}

function sourceActor(value: AgentFixture) {
  return {
    kind: "agent" as const,
    participantId: value.participantId,
    roleId: value.roleId,
    agentBinding: value.agentBinding,
  };
}

function sourceEvent(source: AgentFixture, automationDepth = 0): ConversationInboundEvent {
  return createConversationInboundEvent({
    sourceEventKeyHash: hashConversationSourceEventKey(`source:${source.participantId}`),
    target: {
      integrationId: source.integrationId,
      projectId,
      conversationId,
      threadId: null,
    },
    kind: "message.created",
    actor: { kind: "human", participantId: "ptc_human0001", roleId: null },
    content: {
      artifactId: "art_peer_source01",
      contentHash: `sha256:${"a".repeat(64)}`,
      byteCount: 1,
      mediaType: "text/plain; charset=utf-8",
    },
    mentions: { roleIds: [], participantIds: [source.participantId] },
    replyToEventId: null,
    signalCode: null,
    automationDepth,
    occurredAt: "2026-09-18T00:00:00.000Z",
  });
}

afterEach(removeTemporaryRoots);

describe("co-resident conversation peer turn router", () => {
  it.each([
    ["product owner to hired agent", 1, 2],
    ["hired agent to product owner", 2, 1],
    ["hired agent to hired agent", 2, 3],
  ])("routes %s through the receiver runtime", async (_label, sourceIndex, targetIndex) => {
    const root = await temporaryRoot();
    const agents = [agent(1, "product-owner"), agent(2, "researcher"), agent(3, "developer")];
    const source = agents[sourceIndex - 1]!;
    const target = agents[targetIndex - 1]!;
    const router = new CoResidentConversationPeerTurnRouter();
    const received: ConversationInboundEvent[] = [];
    const deliver = vi.fn(async () => undefined);
    const artifacts = await FileSystemCas.open(resolve(root, target.integrationId));
    registerConversationPeerTurnEndpoint({
      router,
      integrationId: target.integrationId,
      projectId,
      participantId: target.participantId,
      conversationIds: [conversationId],
      acceptedPeers: agents.filter((candidate) => candidate !== target).map(peer),
      artifacts,
      handle: async (event) => {
        received.push(event);
        return [];
      },
      deliver,
    });

    await expect(
      router.dispatch({
        taskId: `tsk_${"a".repeat(20)}`,
        sourceEvent: sourceEvent(source),
        sourceActor: sourceActor(source),
        targetParticipantId: target.participantId,
        task: "Review the bounded change and report the result.",
        requestedAt: "2026-09-18T00:00:01.000Z",
      }),
    ).resolves.toBe("accepted");

    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({
      target: { integrationId: target.integrationId, projectId, conversationId },
      actor: { participantId: source.participantId, roleId: source.roleId },
      mentions: { participantIds: [target.participantId], roleIds: [] },
      coordination: {
        kind: "task.assignment",
        taskId: `tsk_${"a".repeat(20)}`,
        coordinatorParticipantId: source.participantId,
      },
      automationDepth: 1,
    });
    const task = await artifacts.get(
      `lervo-cas://sha256/${received[0]!.content.contentHash.slice("sha256:".length)}`,
    );
    expect(new TextDecoder().decode(task)).toBe("Review the bounded change and report the result.");
    expect(deliver).toHaveBeenCalledOnce();
  });

  it("fails before receiver work for an unbound source or exhausted chain", async () => {
    const root = await temporaryRoot();
    const source = agent(1, "product-owner");
    const target = agent(2, "researcher");
    const router = new CoResidentConversationPeerTurnRouter();
    const handle = vi.fn(async () => []);
    registerConversationPeerTurnEndpoint({
      router,
      integrationId: target.integrationId,
      projectId,
      participantId: target.participantId,
      conversationIds: [conversationId],
      acceptedPeers: [],
      artifacts: await FileSystemCas.open(resolve(root, "target")),
      handle,
      deliver: async () => undefined,
    });
    const request = {
      taskId: `tsk_${"a".repeat(20)}`,
      sourceEvent: sourceEvent(source),
      sourceActor: sourceActor(source),
      targetParticipantId: target.participantId,
      task: "Review this.",
      requestedAt: "2026-09-18T00:00:01.000Z",
    };
    await expect(router.dispatch(request)).rejects.toThrow("not bound exactly once");
    await expect(
      router.dispatch({ ...request, sourceEvent: sourceEvent(source, 8) }),
    ).rejects.toThrow("automation bound");
    expect(handle).not.toHaveBeenCalled();
  });

  it("returns a co-resident delegated result to the exact coordinator runtime", async () => {
    const root = await temporaryRoot();
    const source = agent(1, "product-owner");
    const target = agent(2, "researcher");
    const router = new CoResidentConversationPeerTurnRouter();
    const sourceArtifacts = await FileSystemCas.open(resolve(root, "source"));
    const targetArtifacts = await FileSystemCas.open(resolve(root, "target"));
    const stored = await targetArtifacts.put("조사와 요청된 후속 조치를 완료했습니다.");
    const returned: ConversationInboundEvent[] = [];
    const sourceDeliver = vi.fn(async () => undefined);
    const targetDeliver = vi.fn(async () => undefined);
    registerConversationPeerTurnEndpoint({
      router,
      integrationId: source.integrationId,
      projectId,
      participantId: source.participantId,
      conversationIds: [conversationId],
      acceptedPeers: [peer(target)],
      artifacts: sourceArtifacts,
      handle: async (event) => {
        returned.push(event);
        return [];
      },
      deliver: sourceDeliver,
    });
    registerConversationPeerTurnEndpoint({
      router,
      integrationId: target.integrationId,
      projectId,
      participantId: target.participantId,
      conversationIds: [conversationId],
      acceptedPeers: [peer(source)],
      artifacts: targetArtifacts,
      handle: async (_event) => {
        const result = {
          outboundId: `cvo_${"f".repeat(64)}`,
          actor: sourceActor(target),
          content: {
            artifactId: `art_${stored.contentHash.slice("sha256:".length, 60)}`,
            contentHash: stored.contentHash,
            byteCount: stored.byteCount,
            mediaType: "text/markdown; charset=utf-8",
          },
          coordination: {
            kind: "task.result",
            taskId: `tsk_${"r".repeat(20)}`,
            coordinatorParticipantId: source.participantId,
          },
          automationDepth: 2,
          createdAt: "2026-09-18T00:00:02.000Z",
        } as ConversationOutboundMessage;
        return [{ result: { status: "completed", outbound: result } } as never];
      },
      deliver: targetDeliver,
    });

    await router.dispatch({
      taskId: `tsk_${"r".repeat(20)}`,
      sourceEvent: sourceEvent(source),
      sourceActor: sourceActor(source),
      targetParticipantId: target.participantId,
      task: "Inspect and complete the requested follow-up.",
      requestedAt: "2026-09-18T00:00:01.000Z",
    });

    expect(returned).toHaveLength(1);
    expect(returned[0]).toMatchObject({
      actor: { participantId: target.participantId },
      mentions: { participantIds: [source.participantId] },
      coordination: {
        kind: "task.result",
        taskId: `tsk_${"r".repeat(20)}`,
        coordinatorParticipantId: source.participantId,
      },
    });
    const copied = await sourceArtifacts.get(
      `lervo-cas://sha256/${returned[0]!.content.contentHash.slice("sha256:".length)}`,
    );
    expect(new TextDecoder().decode(copied)).toBe("조사와 요청된 후속 조치를 완료했습니다.");
    expect(targetDeliver).toHaveBeenCalledOnce();
    expect(sourceDeliver).toHaveBeenCalledOnce();
  });

  it("returns not_registered so a remote peer can be addressed through Discord", async () => {
    const source = agent(1, "product-owner");
    const target = agent(2, "researcher");
    const router = new CoResidentConversationPeerTurnRouter();
    await expect(
      router.dispatch({
        taskId: `tsk_${"a".repeat(20)}`,
        sourceEvent: sourceEvent(source),
        sourceActor: sourceActor(source),
        targetParticipantId: target.participantId,
        task: "Review this.",
        requestedAt: "2026-09-18T00:00:01.000Z",
      }),
    ).resolves.toBe("not_registered");
  });
});
