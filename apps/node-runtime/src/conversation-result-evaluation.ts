import type { NodeDiscordConversationConfig } from "./config-types.js";

export interface ConversationResultEvaluationSelection {
  provider: "codex" | "claude";
  model?: string;
  reasoningEffort?: "low" | "medium" | "high" | "xhigh" | "max";
}

export function conversationResultEvaluationSelection(
  config: NodeDiscordConversationConfig,
): ConversationResultEvaluationSelection {
  return (
    config.routing?.resultEvaluation ??
    config.routing?.evaluation ?? { provider: config.command.provider }
  );
}
