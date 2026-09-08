import type { NodeDiscordConversationConfig } from "./config-types.js";
import { configRecord, configText, exactConfigKeys } from "./config-values.js";
import { NodeRuntimeError } from "./errors.js";

export function parseDiscordAgentOrganization(
  value: unknown,
): NodeDiscordConversationConfig["organization"] {
  if (value === undefined) return undefined;
  const source = configRecord(value, "discordConversation.organization");
  exactConfigKeys(source, ["organizationId", "teamId"], "discordConversation.organization");
  const organizationId = configText(source.organizationId, "organization organizationId");
  const teamId = configText(source.teamId, "organization teamId");
  if (
    !/^org_[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/u.test(organizationId) ||
    !/^team_[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/u.test(teamId)
  ) {
    throw new NodeRuntimeError(
      "invalid_config",
      "The Discord agent organization binding is invalid.",
    );
  }
  return { organizationId, teamId };
}
