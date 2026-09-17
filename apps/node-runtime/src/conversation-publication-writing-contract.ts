import {
  adaptiveConversationWritingContract,
  fixedConversationStatusWritingContract,
  realtimeConversationWritingContract,
} from "@lervo/core";
import type { WritingContract } from "@lervo/schemas";

import type { DiscordConversationMode } from "./discord-conversation-mode.js";

export function conversationPublicationWritingContract(input: {
  mode: DiscordConversationMode | null;
  independentReadEvaluation: boolean;
}): WritingContract {
  if (input.mode === "read_only" || input.mode === "clarify") {
    return input.independentReadEvaluation
      ? adaptiveConversationWritingContract
      : realtimeConversationWritingContract;
  }
  if (input.mode === "work" || input.mode === "goal") {
    return realtimeConversationWritingContract;
  }
  return fixedConversationStatusWritingContract;
}
