import {
  createVerifiedConversationControlReply,
  readConversationControlMessage,
} from "@lervo/conversation-control";
import { fixedConversationStatusWritingContract } from "@lervo/core";
import type { ConversationResponder } from "@lervo/interaction";
import type { ConversationInboundEvent } from "@lervo/schemas";
import type { ArtifactStore } from "@lervo/storage-contract";

const deliberationSignalCodes = new Set([
  "deliberation.artifact.recorded",
  "deliberation.attention",
  "deliberation.completed",
]);

export function isDeliberationPublicationSignal(event: ConversationInboundEvent): boolean {
  return (
    event.kind === "signal.raised" &&
    event.signalCode !== null &&
    deliberationSignalCodes.has(event.signalCode)
  );
}

/** Publishes Lervo-owned status text without spending another provider turn. */
export class ConversationDeliberationSignalResponder implements ConversationResponder {
  constructor(
    private readonly options: {
      artifactStore: ArtifactStore;
      delegate: ConversationResponder;
      now?: () => Date;
    },
  ) {}

  async respond(input: Parameters<ConversationResponder["respond"]>[0]) {
    if (!isDeliberationPublicationSignal(input.event)) {
      return this.options.delegate.respond(input);
    }
    const content = await readConversationControlMessage({
      artifactStore: this.options.artifactStore,
      event: input.event,
    });
    const reply = await createVerifiedConversationControlReply({
      artifactStore: this.options.artifactStore,
      writingContract: fixedConversationStatusWritingContract,
      content,
      ...(this.options.now === undefined ? {} : { now: this.options.now }),
    });
    reply.deliveryRelation = input.event.replyToEventId === null ? "standalone" : "reply";
    return reply;
  }
}
