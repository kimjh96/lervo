import {
  createConversationInboundEvent,
  hashConversationSourceEventKey,
} from "@lervo/conversation-contract";
import {
  createVerifiedConversationControlReply,
  readConversationControlMessage,
} from "@lervo/conversation-control";
import { fixedConversationStatusWritingContract } from "@lervo/core";
import type { ConversationResponder } from "@lervo/interaction";
import type { ConversationInboundEvent } from "@lervo/schemas";
import type { ArtifactStore } from "@lervo/storage-contract";

import type { ConversationRequestedEffect } from "./conversation-intent-resolver.js";
import type { DiscordPeerAgentBinding } from "./discord-conversation-composition.js";
import type { DiscordPlatformActionResponder } from "./discord-conversation-mode.js";

type NonPlatformEffect =
  { kind: "none" } | { kind: "repository_work" } | { kind: "supervision_goal_request" };

/** The reviewed automation chain bound a delegated turn must stay inside. */
const maximumAutomationDepth = 8;

function delegation(value: string): { roleId: string; task: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("The delegation specification is not valid JSON.");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("The delegation specification must be an object.");
  }
  const { roleId, task, ...rest } = parsed as Record<string, unknown>;
  if (
    Object.keys(rest).length !== 0 ||
    typeof roleId !== "string" ||
    typeof task !== "string" ||
    roleId.trim().length === 0 ||
    task.trim().length === 0
  ) {
    throw new Error("The delegation specification requires exactly roleId and task.");
  }
  return { roleId: roleId.trim(), task: task.trim() };
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
      integrationId: string;
      projectId: string;
      parentParticipantId: string;
      parentRoleId: string;
      parentAgentBinding?: ConversationInboundEvent["actor"]["agentBinding"];
      peers: readonly DiscordPeerAgentBinding[];
      dispatch(event: ConversationInboundEvent): Promise<void>;
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
    const { roleId, task } = delegation(effect.specification);
    const target = this.options.peers.find(
      (peer) =>
        peer.roleId === roleId && peer.conversationIds.includes(input.event.target.conversationId),
    );
    if (target === undefined) {
      throw new Error("No hired agent with that role participates in this conversation.");
    }
    const artifact = await this.options.artifactStore.put(task);
    await this.options.dispatch(
      createConversationInboundEvent({
        sourceEventKeyHash: hashConversationSourceEventKey(
          `delegate:${input.event.eventId}:${target.participantId}`,
        ),
        target: {
          integrationId: this.options.integrationId,
          projectId: this.options.projectId,
          conversationId: input.event.target.conversationId,
          threadId: input.event.target.threadId,
        },
        kind: "message.created",
        actor: {
          kind: "agent",
          participantId: this.options.parentParticipantId,
          roleId: this.options.parentRoleId,
          agentBinding: this.options.parentAgentBinding ?? null,
        },
        content: {
          artifactId: `art_${artifact.contentHash.slice("sha256:".length, 60)}`,
          contentHash: artifact.contentHash,
          byteCount: artifact.byteCount,
          mediaType: "text/plain; charset=utf-8",
        },
        // Addressing the hired agent by participant is what makes the ownership ladder select it,
        // so the delegated turn is owned and answered by that agent rather than this one.
        mentions: { roleIds: [], participantIds: [target.participantId] },
        replyToEventId: null,
        signalCode: null,
        automationDepth: Math.min(input.event.automationDepth + 1, maximumAutomationDepth),
        occurredAt: (this.options.now ?? (() => new Date()))().toISOString(),
      }),
    );
    const message = await readConversationControlMessage({
      artifactStore: this.options.artifactStore,
      event: input.event,
    });
    const name = target.displayName ?? roleId;
    const content = /\p{Script=Hangul}/u.test(message)
      ? `${name}에게 이 작업을 넘겼습니다. 해당 에이전트가 자신의 맥락과 세션에서 이어서 응답하고 수행합니다.`
      : `I handed this task to ${name}. That agent answers and works from its own context and session.`;
    return createVerifiedConversationControlReply({
      artifactStore: this.options.artifactStore,
      writingContract: fixedConversationStatusWritingContract,
      content,
      ...(this.options.now === undefined ? {} : { now: this.options.now }),
    });
  }
}
