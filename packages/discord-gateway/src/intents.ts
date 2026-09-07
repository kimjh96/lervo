export const discordGatewayIntents = {
  guilds: 1 << 0,
  guildMessages: 1 << 9,
  directMessages: 1 << 12,
  messageContent: 1 << 15,
} as const;

export function requiredDiscordConversationIntents(input: {
  guildMessages: boolean;
  directMessages: boolean;
}): number {
  return (
    discordGatewayIntents.messageContent |
    (input.guildMessages ? discordGatewayIntents.guilds | discordGatewayIntents.guildMessages : 0) |
    (input.directMessages ? discordGatewayIntents.directMessages : 0)
  );
}

export function includesDiscordGatewayIntents(configured: number, required: number): boolean {
  return (configured & required) === required;
}
