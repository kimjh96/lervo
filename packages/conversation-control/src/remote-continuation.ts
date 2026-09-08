import type { ConversationReplyCandidate } from "@lervo/interaction";

import {
  createVerifiedConversationControlReply,
  readConversationControlMessage,
} from "./response-artifacts.js";
import type { ConversationRemoteContinuationResponderOptions } from "./types.js";
import { ConversationControlError } from "./types.js";

function timestamp(now: () => Date): string {
  const value = now();
  if (!Number.isFinite(value.getTime())) {
    throw new ConversationControlError(
      "control_command_invalid",
      "The remote continuation time is invalid.",
    );
  }
  return value.toISOString();
}

function continuationAcknowledgement(request: string): string {
  return /\p{Script=Hangul}/u.test(request)
    ? "요청을 접수했습니다. 실행 노드가 작업을 시작하면 진행 상태를 이어서 알리고, 완료 후 실제 변경과 검증 결과를 이 대화에 남기겠습니다."
    : "I received the request. I will continue here with progress once an execution node starts it, then report the verified changes and result when it finishes.";
}

export class ConversationRemoteContinuationResponder {
  private readonly now: () => Date;

  constructor(private readonly options: ConversationRemoteContinuationResponderOptions) {
    this.now = options.now ?? (() => new Date());
  }

  async respond(
    input: Parameters<import("@lervo/interaction").ConversationResponder["respond"]>[0],
  ): Promise<ConversationReplyCandidate> {
    if (input.event.actor.kind !== "human") {
      throw new ConversationControlError(
        "remote_continuation_denied",
        "Only an authenticated mapped human participant may request remote continuation.",
      );
    }
    const requestedAt = timestamp(this.now);
    const request = await readConversationControlMessage({
      artifactStore: this.options.artifactStore,
      event: input.event,
    });
    if (request.trim().length === 0 || request.length > 16_384 || request.includes("\0")) {
      throw new ConversationControlError(
        "control_command_invalid",
        "The remote continuation request is empty or exceeds the bounded text limit.",
      );
    }
    try {
      await this.options.continuation.request({
        projectId: input.event.target.projectId,
        conversationId: input.event.target.conversationId,
        threadId: input.event.target.threadId,
        eventId: input.event.eventId,
        participantId: input.event.actor.participantId,
        request,
        requestContentHash: input.event.content.contentHash,
        requestedAt,
      });
    } catch (error) {
      throw new ConversationControlError(
        "remote_continuation_failed",
        "The remote continuation request could not be queued safely.",
        { cause: error instanceof Error ? error : undefined },
      );
    }
    return createVerifiedConversationControlReply({
      artifactStore: this.options.artifactStore,
      writingContract: this.options.writingContract,
      ...(this.options.semanticEvaluator === undefined
        ? {}
        : { semanticEvaluator: this.options.semanticEvaluator }),
      content: continuationAcknowledgement(request),
      now: this.now,
    });
  }
}
