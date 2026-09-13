import type { NodeDiscordConversationConfig } from "./config-types.js";

export function discordWorkforceExecution(
  config: NodeDiscordConversationConfig,
  runtimeConfigPath: string | undefined,
): "separate_deployment" | "conversation_delegate" | "configured_agent" {
  const actions = config.administration?.allowedActions ?? [];
  if (!actions.includes("workforce.agent.hire")) return "configured_agent";
  return runtimeConfigPath !== undefined && actions.includes("incoming_webhook.create")
    ? "separate_deployment"
    : "conversation_delegate";
}
