import { createHash } from "node:crypto";

import type { ConversationAgentBinding, ConversationInboundEvent } from "@lervo/schemas";

import type { DiscordPeerAgentBinding } from "./discord-conversation-composition.js";

const DISCUSSION_PARTICIPANT_COUNT = 2;
const MAXIMUM_DISCORD_MESSAGE_CHARACTERS = 2_000;

export interface ConversationDiscussionParticipant {
  participantId: string;
  roleId: string;
  displayName: string | null;
  applicationId: string;
  agentBinding: ConversationAgentBinding;
}

export interface ConversationDiscussionAssignmentEnvelope {
  schemaVersion: 1;
  discussionId: string;
  turnId: string;
  parentTurnId: null;
  source: {
    participantId: string;
    roleId: string;
    agentBinding: ConversationAgentBinding;
  };
  targets: Array<{
    participantId: string;
    roleId: string;
    agentBinding: ConversationAgentBinding;
  }>;
  conversation: Omit<ConversationInboundEvent["target"], "integrationId">;
  taskDigest: string;
  sharedContextDigest: string;
  deadlineAt: string;
  automationDepth: number;
  executionProfile: "review";
  idempotencyKey: string;
}

function digest(value: unknown): string {
  return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}

function applicationId(peer: DiscordPeerAgentBinding): string | null {
  const values = peer.participantKeys.flatMap((key) => {
    const match = /^bot:(\d{1,32})$/u.exec(key);
    return match === null ? [] : [match[1]!];
  });
  return values.length === 1 ? values[0]! : null;
}

export function selectConversationDiscussionParticipants(input: {
  sourceEventId: string;
  conversationId: string;
  peers: readonly DiscordPeerAgentBinding[];
}): ConversationDiscussionParticipant[] {
  const byAgent = new Map<string, ConversationDiscussionParticipant>();
  for (const peer of input.peers) {
    const botApplicationId = applicationId(peer);
    if (!peer.conversationIds.includes(input.conversationId) || botApplicationId === null) continue;
    const participant: ConversationDiscussionParticipant = {
      participantId: peer.participantId,
      roleId: peer.roleId,
      displayName: peer.displayName ?? null,
      applicationId: botApplicationId,
      agentBinding: structuredClone(peer.agentBinding),
    };
    const existing = byAgent.get(peer.agentBinding.agentId);
    if (existing !== undefined && JSON.stringify(existing) !== JSON.stringify(participant)) {
      throw new Error("One discussion agent has conflicting peer bindings.");
    }
    byAgent.set(peer.agentBinding.agentId, participant);
  }
  return [...byAgent.values()]
    .map((participant) => ({
      participant,
      score: digest([input.sourceEventId, participant.participantId]),
    }))
    .sort((left, right) =>
      left.score === right.score
        ? left.participant.participantId.localeCompare(right.participant.participantId)
        : right.score.localeCompare(left.score),
    )
    .slice(0, DISCUSSION_PARTICIPANT_COUNT)
    .map(({ participant }) => participant);
}

export function createConversationDiscussionAssignment(input: {
  event: ConversationInboundEvent;
  source: {
    participantId: string;
    roleId: string;
    agentBinding: ConversationAgentBinding;
  };
  targets: ConversationDiscussionParticipant[];
  taskContentHash: string;
  requestedAt: string;
}): ConversationDiscussionAssignmentEnvelope {
  if (
    input.targets.length !== DISCUSSION_PARTICIPANT_COUNT ||
    new Set(input.targets.map((target) => target.agentBinding.agentId)).size !==
      DISCUSSION_PARTICIPANT_COUNT
  ) {
    throw new Error("A distributed discussion requires two independent target agents.");
  }
  const requestedAtMs = Date.parse(input.requestedAt);
  if (!Number.isFinite(requestedAtMs) || input.event.automationDepth >= 6) {
    throw new Error("The distributed discussion request exceeds its execution bound.");
  }
  const basis = {
    sourceEventId: input.event.eventId,
    source: input.source,
    targets: input.targets.map(({ participantId, roleId, agentBinding }) => ({
      participantId,
      roleId,
      agentBinding,
    })),
    conversation: {
      projectId: input.event.target.projectId,
      conversationId: input.event.target.conversationId,
      threadId: input.event.target.threadId,
    },
    taskDigest: input.taskContentHash,
  };
  const suffix = createHash("sha256")
    .update(JSON.stringify(basis))
    .digest("base64url")
    .slice(0, 20);
  const discussionId = `dsc_${suffix}`;
  return {
    schemaVersion: 1,
    discussionId,
    turnId: `dturn_${createHash("sha256").update(`${discussionId}:assignment`).digest("hex").slice(0, 40)}`,
    parentTurnId: null,
    source: structuredClone(input.source),
    targets: basis.targets,
    conversation: structuredClone(basis.conversation),
    taskDigest: input.taskContentHash,
    sharedContextDigest: input.taskContentHash,
    deadlineAt: new Date(requestedAtMs + 5 * 60_000).toISOString(),
    automationDepth: input.event.automationDepth + 1,
    executionProfile: "review",
    idempotencyKey: `idk_${createHash("sha256").update(`${discussionId}:assignment`).digest("base64url").slice(0, 32)}`,
  };
}

export function renderConversationDiscussionAssignment(input: {
  participants: ConversationDiscussionParticipant[];
  topic: string;
  language: "ko" | "en";
}): string {
  const addresses = input.participants
    .map((participant) => `<@${participant.applicationId}>`)
    .join(" ");
  const instruction =
    input.language === "ko"
      ? "각자 자신의 실제 역할, 현재 맥락, 저장소 지식을 바탕으로 아래 주제를 독립적으로 검토해 주세요. 임시 검토자 인격이나 다른 에이전트의 이름을 사용하지 말고, 결론·근거·반대 의견을 간결히 답해주세요."
      : "Independently review the topic below from your actual role, current context, and repository knowledge. Do not adopt a temporary reviewer persona or speak for another agent. Give a concise conclusion, evidence, and objections.";
  const prefix = `${addresses}\n\n${instruction}\n\n`;
  const remaining = MAXIMUM_DISCORD_MESSAGE_CHARACTERS - [...prefix].length;
  if (remaining < 1) throw new Error("The discussion assignment addresses exceed Discord limits.");
  return `${prefix}${[...input.topic].slice(0, remaining).join("")}`;
}

export function exactDiscussionPeer(input: {
  event: ConversationInboundEvent;
  peers: readonly DiscordPeerAgentBinding[];
}): DiscordPeerAgentBinding | null {
  if (input.event.actor.kind !== "agent" || input.event.actor.agentBinding == null) return null;
  const matches = input.peers.filter(
    (peer) =>
      peer.participantId === input.event.actor.participantId &&
      peer.roleId === input.event.actor.roleId &&
      peer.agentBinding.agentId === input.event.actor.agentBinding!.agentId &&
      peer.agentBinding.roleVersion === input.event.actor.agentBinding!.roleVersion &&
      peer.agentBinding.roleContractHash === input.event.actor.agentBinding!.roleContractHash &&
      peer.agentBinding.roleProfileHash === input.event.actor.agentBinding!.roleProfileHash &&
      peer.conversationIds.includes(input.event.target.conversationId),
  );
  if (matches.length > 1) throw new Error("The discussion source has duplicate peer bindings.");
  return matches[0] ?? null;
}
