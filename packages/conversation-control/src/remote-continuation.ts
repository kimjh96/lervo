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
    let queued;
    try {
      queued = await this.options.continuation.request({
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
      semanticEvaluator: this.options.semanticEvaluator,
      content: `Remote execution request ${queued.deliveryId} for workstream ${queued.workstreamId} revision ${queued.workstreamRevision} was ${queued.status}. The selected provider is ${queued.provider} and the role is ${queued.roleId}. This confirms queueing only; execution and repository changes remain separately verified.`,
      now: this.now,
    });
  }
}
