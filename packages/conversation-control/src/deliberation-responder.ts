import type { ConversationReplyCandidate } from "@lervo/interaction";

import { createConversationDeliberationResponse } from "./command-response.js";
import { parseConversationControlCommand } from "./parser.js";
import {
  createVerifiedConversationControlReply,
  readConversationControlMessage,
} from "./response-artifacts.js";
import type { ConversationDeliberationResponderOptions } from "./types.js";
import { ConversationControlError } from "./types.js";

export class ConversationDeliberationResponder {
  private readonly now: () => Date;

  constructor(private readonly options: ConversationDeliberationResponderOptions) {
    this.now = options.now ?? (() => new Date());
  }

  async respond(
    input: Parameters<import("@lervo/interaction").ConversationResponder["respond"]>[0],
  ): Promise<ConversationReplyCandidate> {
    const command = parseConversationControlCommand(
      await readConversationControlMessage({
        artifactStore: this.options.artifactStore,
        event: input.event,
      }),
    );
    if (command === null || "deliveryId" in command) {
      throw new ConversationControlError(
        "control_command_invalid",
        "This is not an explicit Lervo deliberation command.",
      );
    }
    const at = this.now().toISOString();
    const content = await createConversationDeliberationResponse({
      deliberations: this.options.deliberations,
      event: input.event,
      command,
      at,
    });
    return createVerifiedConversationControlReply({
      artifactStore: this.options.artifactStore,
      writingContract: this.options.writingContract,
      content,
      now: this.now,
    });
  }
}
