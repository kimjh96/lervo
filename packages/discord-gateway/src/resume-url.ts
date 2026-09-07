const OFFICIAL_DISCORD_GATEWAY_HOST = "gateway.discord.gg";
const OFFICIAL_DISCORD_HOST_SUFFIX = ".discord.gg";

export function isAllowedDiscordGatewayResumeUrl(initial: URL, resume: URL): boolean {
  if (resume.port !== initial.port) return false;
  if (initial.hostname === OFFICIAL_DISCORD_GATEWAY_HOST) {
    return resume.hostname.endsWith(OFFICIAL_DISCORD_HOST_SUFFIX);
  }
  return resume.hostname === initial.hostname;
}
