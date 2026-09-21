import { resolve } from "node:path";

import { FileSystemCas } from "@lervo/cas";
import {
  createConversationInboundEvent,
  hashConversationSourceEventKey,
} from "@lervo/conversation-contract";
import type { ConversationAgentBinding, ConversationInboundEvent } from "@lervo/schemas";
import { afterEach, describe, expect, it } from "vitest";

import { ConversationDiscussionRuntime } from "../src/conversation-discussion-runtime.js";
import type { DiscordPeerAgentBinding } from "../src/discord-conversation-composition.js";
import { removeTemporaryRoots, temporaryRoot } from "./fixture.js";

const projectId = "prj_discussion01";
const conversationId = "cnv_general0001";
const coordinatorParticipantId = "ptc_coordinator01";
const firstParticipantId = "ptc_productowner01";
const secondParticipantId = "ptc_reviewer0001";

function binding(character: string): ConversationAgentBinding {
  return {
    agentId: `agt_${character.repeat(24)}`,
    roleVersion: "1.0.0",
    roleContractHash: `sha256:${character.repeat(64)}`,
    roleProfileHash: `sha256:${character.repeat(64)}`,
  };
}

const coordinatorBinding = binding("a");
const firstBinding = binding("b");
const secondBinding = binding("c");

function peer(input: {
  participantId: string;
  roleId: string;
  applicationId: string;
  agentBinding: ConversationAgentBinding;
}): DiscordPeerAgentBinding {
  return {
    participantKeys: [`bot:${input.applicationId}`],
    participantId: input.participantId,
    roleId: input.roleId,
    displayName: input.participantId,
    agentBinding: input.agentBinding,
    tenantKeys: ["123456789012345678"],
    conversationIds: [conversationId],
  };
}

const coordinatorPeer = peer({
  participantId: coordinatorParticipantId,
  roleId: "ceo",
  applicationId: "423456789012345678",
  agentBinding: coordinatorBinding,
});
const firstPeer = peer({
  participantId: firstParticipantId,
  roleId: "product-owner",
  applicationId: "523456789012345678",
  agentBinding: firstBinding,
});
const secondPeer = peer({
  participantId: secondParticipantId,
  roleId: "reviewer",
  applicationId: "623456789012345678",
  agentBinding: secondBinding,
});

async function event(input: {
  artifacts: FileSystemCas;
  key: string;
  integrationId: string;
  actor: ConversationInboundEvent["actor"];
  content: string;
  mentions: string[];
  replyToEventId: string | null;
  coordination?: ConversationInboundEvent["coordination"];
  occurredAt: string;
}): Promise<ConversationInboundEvent> {
  const stored = await input.artifacts.put(input.content);
  return createConversationInboundEvent({
    sourceEventKeyHash: hashConversationSourceEventKey(input.key),
    target: {
      integrationId: input.integrationId,
      projectId,
      conversationId,
      threadId: null,
    },
    kind: "message.created",
    actor: input.actor,
    content: {
      artifactId: `art_${stored.contentHash.slice("sha256:".length, 60)}`,
      contentHash: stored.contentHash,
      byteCount: stored.byteCount,
      mediaType: "text/plain; charset=utf-8",
    },
    mentions: { roleIds: [], participantIds: input.mentions },
    replyToEventId: input.replyToEventId,
    signalCode: null,
    ...(input.coordination === undefined ? {} : { coordination: input.coordination }),
    automationDepth: input.actor.kind === "human" ? 0 : 1,
    occurredAt: input.occurredAt,
  });
}

afterEach(removeTemporaryRoots);

describe("cross-Node conversation discussion runtime", () => {
  it("selects real peers, resumes accepted turns, and converges only after both contributions", async () => {
    const root = await temporaryRoot();
    const artifacts = await FileSystemCas.open(resolve(root, "artifacts"));
    const coordinatorPath = resolve(root, "coordinator.sqlite");
    const coordinator = await ConversationDiscussionRuntime.open({
      path: coordinatorPath,
      integrationId: "itg_discord_test",
      participantId: coordinatorParticipantId,
      roleId: "ceo",
      agentBinding: coordinatorBinding,
      peers: [firstPeer, secondPeer],
      artifacts,
      now: () => new Date("2026-09-18T05:00:00.000Z"),
    });
    const origin = await event({
      artifacts,
      key: "human-discussion-request",
      integrationId: "itg_coordinator01",
      actor: { kind: "human", participantId: "ptc_operator01", roleId: null },
      content: "실제 에이전트들이 토론하고 하나의 결론으로 수렴해줘.",
      mentions: [coordinatorParticipantId],
      replyToEventId: null,
      occurredAt: "2026-09-18T05:00:00.000Z",
    });
    const started = await coordinator.start({
      event: origin,
      topic: "교차 노드 토론 프로토콜을 채택할지 검토한다.",
      language: "ko",
    });
    expect(started).toMatchObject({
      status: "started",
      participantIds: expect.arrayContaining([firstParticipantId, secondParticipantId]),
    });
    if (started.status !== "started") throw new Error("discussion did not start");
    expect(started.content).toContain("<@523456789012345678>");
    expect(started.content).toContain("<@623456789012345678>");
    expect(started.content).not.toContain("운영·보안·관측성 검토자");

    const assignment = await event({
      artifacts,
      key: "discord-assignment-message",
      integrationId: "itg_firstagent01",
      actor: {
        kind: "agent",
        participantId: coordinatorParticipantId,
        roleId: "ceo",
        agentBinding: coordinatorBinding,
      },
      content: started.content,
      mentions: [firstParticipantId, secondParticipantId],
      replyToEventId: origin.eventId,
      coordination: {
        kind: "discussion.assignment",
        discussionId: started.discussionId,
        activeParticipantId: firstParticipantId,
      },
      occurredAt: "2026-09-18T05:00:01.000Z",
    });
    const firstPath = resolve(root, "first.sqlite");
    let first = await ConversationDiscussionRuntime.open({
      path: firstPath,
      integrationId: "itg_discord_test",
      participantId: firstParticipantId,
      roleId: "product-owner",
      agentBinding: firstBinding,
      peers: [coordinatorPeer, secondPeer],
      artifacts,
    });
    expect(first.ownsCoordinationTurn(assignment)).toBe(true);
    await expect(first.directive(assignment)).resolves.toEqual({
      kind: "assignment",
      discussionId: started.discussionId,
      executionProfile: "review",
    });
    first.close();
    first = await ConversationDiscussionRuntime.open({
      path: firstPath,
      integrationId: "itg_discord_test",
      participantId: firstParticipantId,
      roleId: "product-owner",
      agentBinding: firstBinding,
      peers: [coordinatorPeer, secondPeer],
      artifacts,
    });
    await expect(first.directive(assignment)).resolves.toMatchObject({ kind: "assignment" });
    first.close();

    const firstContribution = await event({
      artifacts,
      key: "first-contribution",
      integrationId: "itg_coordinator01",
      actor: {
        kind: "agent",
        participantId: firstParticipantId,
        roleId: "product-owner",
        agentBinding: firstBinding,
      },
      content: "채택에 찬성합니다. 실제 agent binding이 발화 주체를 보존합니다.",
      mentions: [],
      replyToEventId: origin.eventId,
      coordination: {
        kind: "discussion.contribution",
        discussionId: started.discussionId,
      },
      occurredAt: "2026-09-18T05:00:02.000Z",
    });
    expect(coordinator.ownsCoordinationTurn(firstContribution)).toBe(true);
    const nextAssignment = await coordinator.directive(firstContribution);
    expect(nextAssignment).toMatchObject({
      kind: "next_assignment",
      discussionId: started.discussionId,
      activeParticipantId: secondParticipantId,
    });
    if (nextAssignment.kind !== "next_assignment") {
      throw new Error("next assignment was not prepared");
    }
    expect(nextAssignment.content.indexOf("<@623456789012345678>")).toBeLessThan(
      nextAssignment.content.indexOf("<@523456789012345678>"),
    );
    const secondAssignment = await event({
      artifacts,
      key: "discord-second-assignment-message",
      integrationId: "itg_secondagent01",
      actor: {
        kind: "agent",
        participantId: coordinatorParticipantId,
        roleId: "ceo",
        agentBinding: coordinatorBinding,
      },
      content: nextAssignment.content,
      mentions: [secondParticipantId, firstParticipantId],
      replyToEventId: origin.eventId,
      coordination: {
        kind: "discussion.assignment",
        discussionId: started.discussionId,
        activeParticipantId: secondParticipantId,
      },
      occurredAt: "2026-09-18T05:00:02.500Z",
    });
    const second = await ConversationDiscussionRuntime.open({
      path: resolve(root, "second.sqlite"),
      integrationId: "itg_discord_test",
      participantId: secondParticipantId,
      roleId: "reviewer",
      agentBinding: secondBinding,
      peers: [coordinatorPeer, firstPeer],
      artifacts,
    });
    await expect(second.directive(secondAssignment)).resolves.toMatchObject({
      kind: "assignment",
      discussionId: started.discussionId,
    });
    second.close();

    const secondContribution = await event({
      artifacts,
      key: "second-contribution",
      integrationId: "itg_coordinator01",
      actor: {
        kind: "agent",
        participantId: secondParticipantId,
        roleId: "reviewer",
        agentBinding: secondBinding,
      },
      content: "채택하되 최종 결론 호출 예산을 먼저 예약해야 합니다.",
      mentions: [],
      replyToEventId: origin.eventId,
      coordination: {
        kind: "discussion.contribution",
        discussionId: started.discussionId,
      },
      occurredAt: "2026-09-18T05:00:03.000Z",
    });
    const decision = await coordinator.directive(secondContribution);
    expect(decision).toMatchObject({
      kind: "decision",
      discussionId: started.discussionId,
      executionProfile: "reasoning",
    });
    if (decision.kind !== "decision") throw new Error("decision was not ready");
    expect(decision.priorTurns.map((turn) => turn.text).join("\n")).toContain(
      "교차 노드 토론 프로토콜",
    );
    expect(decision.priorTurns.map((turn) => turn.text).join("\n")).toContain("실제 agent binding");
    coordinator.close();

    const resumed = await ConversationDiscussionRuntime.open({
      path: coordinatorPath,
      integrationId: "itg_discord_test",
      participantId: coordinatorParticipantId,
      roleId: "ceo",
      agentBinding: coordinatorBinding,
      peers: [firstPeer, secondPeer],
      artifacts,
    });
    await expect(resumed.directive(secondContribution)).resolves.toMatchObject({
      kind: "decision",
      discussionId: started.discussionId,
    });
    resumed.markConverged({
      discussionId: started.discussionId,
      eventId: secondContribution.eventId,
      occurredAt: "2026-09-18T05:00:04.000Z",
    });
    resumed.close();
  });

  it("does not create a partial discussion with fewer than two remote agents", async () => {
    const root = await temporaryRoot();
    const artifacts = await FileSystemCas.open(resolve(root, "artifacts"));
    const runtime = await ConversationDiscussionRuntime.open({
      path: resolve(root, "discussion.sqlite"),
      integrationId: "itg_discord_test",
      participantId: coordinatorParticipantId,
      roleId: "ceo",
      agentBinding: coordinatorBinding,
      peers: [firstPeer],
      artifacts,
    });
    const origin = await event({
      artifacts,
      key: "insufficient-discussion",
      integrationId: "itg_coordinator01",
      actor: { kind: "human", participantId: "ptc_operator01", roleId: null },
      content: "토론해줘.",
      mentions: [coordinatorParticipantId],
      replyToEventId: null,
      occurredAt: "2026-09-18T05:00:00.000Z",
    });
    await expect(
      runtime.start({ event: origin, topic: "한 명으로는 시작하지 않는다.", language: "ko" }),
    ).resolves.toEqual({ status: "insufficient_participants", participantCount: 1 });
    runtime.close();
  });

  it("terminalizes an expired partial discussion after restart without inventing a participant", async () => {
    const root = await temporaryRoot();
    const artifacts = await FileSystemCas.open(resolve(root, "artifacts"));
    const path = resolve(root, "deadline.sqlite");
    let runtime = await ConversationDiscussionRuntime.open({
      path,
      integrationId: "itg_coordinator01",
      participantId: coordinatorParticipantId,
      roleId: "ceo",
      agentBinding: coordinatorBinding,
      peers: [firstPeer, secondPeer],
      artifacts,
      now: () => new Date("2026-09-18T05:00:00.000Z"),
    });
    const origin = await event({
      artifacts,
      key: "deadline-origin",
      integrationId: "itg_coordinator01",
      actor: { kind: "human", participantId: "ptc_operator01", roleId: null },
      content: "기한 안에 실제 에이전트 의견만 모아줘.",
      mentions: [coordinatorParticipantId],
      replyToEventId: null,
      occurredAt: "2026-09-18T05:00:00.000Z",
    });
    const started = await runtime.start({ event: origin, topic: "기한 검증", language: "ko" });
    if (started.status !== "started") throw new Error("discussion did not start");
    const contribution = await event({
      artifacts,
      key: "deadline-contribution",
      integrationId: "itg_coordinator01",
      actor: {
        kind: "agent",
        participantId: firstParticipantId,
        roleId: "product-owner",
        agentBinding: firstBinding,
      },
      content: "검증된 첫 번째 의견입니다.",
      mentions: [coordinatorParticipantId],
      replyToEventId: origin.eventId,
      coordination: { kind: "discussion.contribution", discussionId: started.discussionId },
      occurredAt: "2026-09-18T05:00:02.000Z",
    });
    await expect(runtime.directive(contribution)).resolves.toMatchObject({
      kind: "next_assignment",
    });
    runtime.close();

    runtime = await ConversationDiscussionRuntime.open({
      path,
      integrationId: "itg_coordinator01",
      participantId: coordinatorParticipantId,
      roleId: "ceo",
      agentBinding: coordinatorBinding,
      peers: [firstPeer, secondPeer],
      artifacts,
    });
    const [deadline] = runtime.deadlineEvents("2026-09-18T05:05:01.000Z");
    expect(deadline).toMatchObject({
      kind: "signal.raised",
      signalCode: "discussion.deadline",
      coordination: { kind: "discussion.decision", discussionId: started.discussionId },
      replyToEventId: origin.eventId,
    });
    expect(runtime.ownsCoordinationTurn(deadline!)).toBe(true);
    const decision = await runtime.directive(deadline!);
    expect(decision).toMatchObject({
      kind: "decision",
      discussionId: started.discussionId,
      executionProfile: "reasoning",
      terminalState: "failed",
    });
    if (decision.kind !== "decision") throw new Error("deadline decision was not ready");
    expect(decision.priorTurns.map((turn) => turn.text).join("\n")).toContain(
      "검증된 첫 번째 의견",
    );
    expect(runtime.deadlineEvents("2026-09-18T05:05:02.000Z")).toEqual([]);
    runtime.close();
  });
});
