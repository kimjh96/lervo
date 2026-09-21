import {
  createConversationInboundEvent,
  hashConversationSourceEventKey,
} from "@lervo/conversation-contract";
import type { ConversationContextTurn } from "@lervo/conversation-responder";
import type { ConversationInboundEvent } from "@lervo/schemas";
import type { ArtifactStore } from "@lervo/storage-contract";

import {
  buildConversationDiscussionDecisionContext,
  readConversationDiscussionContent,
} from "./conversation-discussion-evidence.js";
import type { SQLiteConversationDiscussionStore } from "./conversation-discussion-store.js";

export type ConversationDiscussionDeadlineDirective =
  | { kind: "none" }
  | {
      kind: "decision";
      discussionId: string;
      executionProfile: "reasoning";
      priorTurns: ConversationContextTurn[];
      terminalState: "failed";
    }
  | { kind: "failure"; discussionId: string; content: string };

export function createConversationDiscussionDeadlineEvents(input: {
  integrationId: string;
  participantId: string;
  store: SQLiteConversationDiscussionStore;
  at: string;
}): ConversationInboundEvent[] {
  return input.store.due(input.at, input.participantId).map(({ discussion }) =>
    createConversationInboundEvent({
      sourceEventKeyHash: hashConversationSourceEventKey(
        `discussion-deadline:v1:${discussion.envelope.discussionId}`,
      ),
      target: {
        integrationId: input.integrationId,
        projectId: discussion.envelope.conversation.projectId,
        conversationId: discussion.envelope.conversation.conversationId,
        threadId: discussion.envelope.conversation.threadId,
      },
      kind: "signal.raised",
      actor: {
        kind: "system",
        participantId: "ptc_lervo_system",
        roleId: null,
        agentBinding: null,
      },
      content: discussion.topic,
      coordination: {
        kind: "discussion.decision",
        discussionId: discussion.envelope.discussionId,
      },
      mentions: { roleIds: [], participantIds: [input.participantId] },
      replyToEventId: discussion.originEventId,
      signalCode: "discussion.deadline",
      audienceParticipation: "eligible",
      automationDepth: Math.min(discussion.envelope.automationDepth + 1, 7),
      occurredAt: input.at,
    }),
  );
}

export async function acceptConversationDiscussionDeadline(input: {
  event: ConversationInboundEvent;
  participantId: string;
  store: SQLiteConversationDiscussionStore;
  artifacts: ArtifactStore;
}): Promise<ConversationDiscussionDeadlineDirective> {
  const coordination = input.event.coordination;
  if (
    coordination?.kind !== "discussion.decision" ||
    input.event.actor.kind !== "system" ||
    input.event.actor.participantId !== "ptc_lervo_system" ||
    !input.event.mentions.participantIds.includes(input.participantId)
  ) {
    return { kind: "none" };
  }
  const discussion = input.store.get(coordination.discussionId);
  if (
    discussion === null ||
    discussion.envelope.source.participantId !== input.participantId ||
    input.event.replyToEventId !== discussion.originEventId ||
    Date.parse(input.event.occurredAt) < Date.parse(discussion.envelope.deadlineAt) ||
    !input.store.claimDecision({
      discussionId: coordination.discussionId,
      eventId: input.event.eventId,
    })
  ) {
    return { kind: "none" };
  }
  if (input.store.contributions(coordination.discussionId).length === 0) {
    const topic = await readConversationDiscussionContent(input.artifacts, discussion.topic);
    return {
      kind: "failure",
      discussionId: coordination.discussionId,
      content: /\p{Script=Hangul}/u.test(topic)
        ? "참여 에이전트들의 응답 기한이 지났지만 검증된 기여가 도착하지 않았습니다. 부분 결론을 만들지 않고 이번 토론을 종료합니다. 새 요청은 계속 처리됩니다."
        : "The participant deadline passed without a verified contribution. This discussion ended without inventing a partial decision; new requests continue normally.",
    };
  }
  return {
    kind: "decision",
    discussionId: coordination.discussionId,
    executionProfile: "reasoning",
    priorTurns: await buildConversationDiscussionDecisionContext({
      artifacts: input.artifacts,
      store: input.store,
      discussion,
      currentEventId: input.event.eventId,
      deadlineExpired: true,
    }),
    terminalState: "failed",
  };
}
