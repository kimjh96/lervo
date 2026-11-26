import {
  createVerifiedConversationControlReply,
  readConversationControlMessage,
} from "@lervo/conversation-control";
import { fixedConversationStatusWritingContract } from "@lervo/core";
import type { ConversationResponder } from "@lervo/interaction";
import type { ConversationInboundEvent } from "@lervo/schemas";
import type { ArtifactStore } from "@lervo/storage-contract";

import type { ConversationRequestedEffect } from "./conversation-intent-resolver.js";
import type { ConversationPeerTurnDispatcher } from "./conversation-peer-turn-router.js";
import type { DiscordPeerAgentBinding } from "./discord-conversation-composition.js";
import type { DiscordPlatformActionResponder } from "./discord-conversation-mode.js";
import { delegatedTaskContent, delegatedTaskId } from "./conversation-delegated-task.js";

type NonPlatformEffect =
  { kind: "none" } | { kind: "repository_work" } | { kind: "supervision_goal_request" };

type DelegationTarget =
  { kind: "participant"; participantId: string } | { kind: "legacy_role"; roleId: string };

function delegation(value: string): { target: DelegationTarget; task: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch (error) {
    throw new Error("The delegation specification is not valid JSON.", { cause: error });
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("The delegation specification must be an object.");
  }
  const { participantId, roleId, task, ...rest } = parsed as Record<string, unknown>;
  const participantSelected = typeof participantId === "string" && participantId.trim().length > 0;
  const roleSelected = typeof roleId === "string" && roleId.trim().length > 0;
  if (
    Object.keys(rest).length !== 0 ||
    typeof task !== "string" ||
    task.trim().length === 0 ||
    participantSelected === roleSelected ||
    (participantId !== undefined && !participantSelected) ||
    (roleId !== undefined && !roleSelected)
  ) {
    throw new Error(
      "The delegation specification requires task and exactly one target: participantId or legacy roleId.",
    );
  }
  return {
    target: participantSelected
      ? { kind: "participant", participantId: participantId.trim() }
      : { kind: "legacy_role", roleId: (roleId as string).trim() },
    task: task.trim(),
  };
}

function remoteAddress(peer: DiscordPeerAgentBinding): string {
  const applicationId = peer.participantKeys
    .map((key) => /^bot:(\d{1,32})$/u.exec(key)?.[1])
    .find((value) => value !== undefined);
  if (applicationId !== undefined) return `<@${applicationId}>`;
  if (peer.displayName !== undefined) return `@${peer.displayName}`;
  throw new Error("The remote peer has no exact Discord address.");
}

/**
 * Hands one bounded task to an agent already hired into this conversation. The delegated request
 * re-enters as an inbound event addressed to that agent, so the existing turn-ownership ladder
 * selects it and the work runs in its own deployment, provider session, and accumulated context
 * instead of the requesting agent's.
 */
export class ConversationTaskDelegateResponder implements DiscordPlatformActionResponder {
  readonly availableEffects: ConversationRequestedEffect["kind"][] = ["workforce_task_delegate"];

  constructor(
    private readonly options: {
      artifactStore: ArtifactStore;
      parentParticipantId: string;
      parentRoleId: string;
      parentAgentBinding?: ConversationInboundEvent["actor"]["agentBinding"];
      remoteCoordinationSpeaker: "bot" | "webhook";
      peers: readonly DiscordPeerAgentBinding[];
      dispatcher: ConversationPeerTurnDispatcher;
      now?: () => Date;
    },
  ) {}

  async respond(
    input: Parameters<ConversationResponder["respond"]>[0],
    effect: Exclude<ConversationRequestedEffect, NonPlatformEffect>,
    authorization: { effectRequesterAuthorized: boolean },
  ) {
    if (!authorization.effectRequesterAuthorized || effect.kind !== "workforce_task_delegate") {
      throw new Error("The conversation delegation action is not authorized.");
    }
    const { target: requestedTarget, task } = delegation(effect.specification);
    const candidates = this.options.peers.filter(
      (peer) =>
        peer.conversationIds.includes(input.event.target.conversationId) &&
        (requestedTarget.kind === "participant"
          ? peer.participantId === requestedTarget.participantId
          : peer.roleId === requestedTarget.roleId),
    );
    if (candidates.length === 0) {
      throw new Error(
        "No hired agent matching that exact target participates in this conversation.",
      );
    }
    if (candidates.length > 1) {
      throw new Error(
        "The legacy role selector matches more than one hired agent; use an exact participantId.",
      );
    }
    if (this.options.parentAgentBinding === undefined || this.options.parentAgentBinding === null) {
      throw new Error("The delegating conversation speaker has no durable hired-agent binding.");
    }
    const target = candidates[0]!;
    const message = await readConversationControlMessage({
      artifactStore: this.options.artifactStore,
      event: input.event,
    });
    const delegatedTask = delegatedTaskContent(task);
    const taskId = delegatedTaskId({
      sourceEventId: input.event.eventId,
      sourceParticipantId: this.options.parentParticipantId,
      targetParticipantId: target.participantId,
    });
    const dispatch = await this.options.dispatcher.dispatch({
      taskId,
      sourceEvent: input.event,
      sourceActor: {
        kind: "agent",
        participantId: this.options.parentParticipantId,
        roleId: this.options.parentRoleId,
        agentBinding: this.options.parentAgentBinding,
      },
      targetParticipantId: target.participantId,
      task: delegatedTask,
      requestedAt: (this.options.now ?? (() => new Date()))().toISOString(),
    });
    if (
      dispatch === "not_registered" &&
      (this.options.remoteCoordinationSpeaker !== "bot" ||
        !target.participantKeys.some((key) => /^bot:\d{1,32}$/u.test(key)))
    ) {
      throw new Error(
        "Remote Discord task coordination requires bot identities at both ends; no task was published.",
      );
    }
    const name = target.displayName ?? target.roleId;
    const content =
      dispatch === "accepted"
        ? /\p{Script=Hangul}/u.test(message)
          ? `${name}에게 이 작업을 넘겼습니다. 해당 에이전트가 자신의 맥락과 세션에서 이어서 응답하고 수행합니다.`
          : `I handed this task to ${name}. That agent answers and works from its own context and session.`
        : `${remoteAddress(target)} ${delegatedTask}`;
    const reply = await createVerifiedConversationControlReply({
      artifactStore: this.options.artifactStore,
      writingContract: fixedConversationStatusWritingContract,
      content,
      ...(this.options.now === undefined ? {} : { now: this.options.now }),
    });
    return dispatch === "accepted"
      ? reply
      : {
          ...reply,
          coordination: {
            kind: "task.assignment" as const,
            taskId,
            coordinatorParticipantId: this.options.parentParticipantId,
          },
          audienceParticipation: "eligible" as const,
        };
  }
}
