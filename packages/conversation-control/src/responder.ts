import type { ConversationReplyCandidate } from "@lervo/interaction";

import { parseConversationControlCommand } from "./parser.js";
import { createConversationControlResponse } from "./command-response.js";
import {
  createVerifiedConversationControlReply,
  readConversationControlMessage,
} from "./response-artifacts.js";
import type { ConversationControlResponderOptions } from "./types.js";
import { ConversationControlError } from "./types.js";

function timestamp(now: () => Date): string {
  const value = now();
  if (!Number.isFinite(value.getTime())) {
    throw new ConversationControlError(
      "control_command_invalid",
      "The conversation control time is invalid.",
    );
  }
  return value.toISOString();
}

export class ConversationControlResponder {
  private readonly now: () => Date;

  constructor(private readonly options: ConversationControlResponderOptions) {
    this.now = options.now ?? (() => new Date());
  }

  async respond(
    input: Parameters<import("@lervo/interaction").ConversationResponder["respond"]>[0],
  ): Promise<ConversationReplyCandidate> {
    const parsed = parseConversationControlCommand(
      await readConversationControlMessage({
        artifactStore: this.options.artifactStore,
        event: input.event,
      }),
    );
    if (parsed === null) {
      throw new ConversationControlError(
        "control_command_invalid",
        "This is not an explicit Lervo control command.",
      );
    }
    const inspectedAt = timestamp(this.now);
    return createVerifiedConversationControlReply({
      artifactStore: this.options.artifactStore,
      writingContract: this.options.writingContract,
      semanticEvaluator: this.options.semanticEvaluator,
      content: await createConversationControlResponse({
        options: this.options,
        event: input.event,
        command: parsed,
        at: inspectedAt,
      }),
      now: this.now,
    });
  }
}
