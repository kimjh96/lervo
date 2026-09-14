import {
  DiscordRestGoalCommand,
  type DiscordConversationAdapter,
  type DiscordGoalInteraction,
  type DiscordIngressResult,
} from "@lervo/adapter-discord";
import type { DiscordConversationDeployment } from "@lervo/conversation-app";

import type { DiscordAgentParticipation } from "./discord-agent-participation.js";
import {
  discordGoalIntakeStatusMessage,
  type DiscordGoalIntakeOutcomes,
} from "./discord-goal-intake-outcomes.js";
import type { NodeDiscordConversationRuntimeOptions } from "./discord-conversation-runtime-types.js";

export async function registerDiscordGoalCommand(input: {
  options: NodeDiscordConversationRuntimeOptions;
  agentParticipation: DiscordAgentParticipation;
  token: string;
}): Promise<DiscordRestGoalCommand | null> {
  const { config } = input.options;
  if (
    config.routing === undefined ||
    config.allowedGuildIds.length === 0 ||
    input.options.outcomeSupervision?.binding.ownerAgentId !== input.agentParticipation.agentId
  )
    return null;
  const command = new DiscordRestGoalCommand({
    applicationId: config.applicationId,
    botToken: input.token,
    allowedGuildIds: config.allowedGuildIds,
    ...(input.options.fetch === undefined ? {} : { fetch: input.options.fetch }),
  });
  await command.register();
  return command;
}

export function goalCommandDeployment(
  commandRest: DiscordRestGoalCommand,
  outcomes: DiscordGoalIntakeOutcomes,
): {
  onGoalCommand: NonNullable<DiscordConversationDeployment["onGoalCommand"]>;
} {
  return {
    onGoalCommand: (input) => handleDiscordGoalCommand({ ...input, commandRest, outcomes }),
  };
}

/**
 * Acknowledge the interaction, then bind its visible message to the canonical request path.
 * The final status edit repeats only the intake outcome the work responder recorded for this
 * exact event; an unobserved outcome is reported as uncertain, never as a connected request.
 */
export async function handleDiscordGoalCommand(input: {
  command: DiscordGoalInteraction;
  adapter: DiscordConversationAdapter;
  process(result: DiscordIngressResult): Promise<void>;
  commandRest: Pick<DiscordRestGoalCommand, "acknowledge" | "update">;
  outcomes: DiscordGoalIntakeOutcomes;
}): Promise<void> {
  const receipt = await input.commandRest.acknowledge(input.command);
  const showFailure = async (message: string) => {
    try {
      await input.commandRest.update(input.command, receipt.messageId, message);
    } catch {
      // Preserve the intake or processing failure; the Gateway reports it.
    }
  };
  let ingress: DiscordIngressResult;
  try {
    ingress = await input.adapter.receiveGoalResponseMessage({
      command: input.command,
      messageId: receipt.messageId,
      occurredAt: receipt.occurredAt,
    });
  } catch (error) {
    await showFailure(
      "목표를 접수하지 못했습니다. 잠시 후 다시 시도하거나 운영 담당자에게 알려 주세요.",
    );
    throw error;
  }
  if (ingress.status !== "accepted") {
    await input.commandRest.update(
      input.command,
      receipt.messageId,
      "이 채널은 담당자의 목표 접수 대상이 아닙니다. 지정된 작업 채널에서 다시 요청해 주세요.",
    );
    return;
  }
  try {
    await input.process(ingress);
  } catch (error) {
    input.outcomes.take(ingress.event.eventId);
    await showFailure(discordGoalIntakeStatusMessage(null));
    throw error;
  }
  await input.commandRest.update(
    input.command,
    receipt.messageId,
    discordGoalIntakeStatusMessage(input.outcomes.take(ingress.event.eventId)),
  );
}
