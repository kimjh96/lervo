import type { WorkforceAgent } from "./types.js";

const AGENT_DISPLAY_NAMES = [
  "Arin",
  "Bora",
  "Ciel",
  "Darin",
  "Eren",
  "Haru",
  "Iris",
  "Juno",
  "Kian",
  "Lumi",
  "Mira",
  "Noel",
  "Orin",
  "Rumi",
  "Sena",
  "Tarin",
] as const;

export function validAgentDisplayName(value: unknown): value is string {
  return (
    typeof value === "string" &&
    [...value].length >= 1 &&
    [...value].length <= 40 &&
    value.trim() === value &&
    !/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(value)
  );
}

export function generateAgentDisplayName(agentId: string): string {
  const suffix = agentId.slice(-4).toUpperCase();
  const index = Number.parseInt(agentId.slice(4, 6), 16) % AGENT_DISPLAY_NAMES.length;
  return `${AGENT_DISPLAY_NAMES[index]}-${suffix}`;
}

export function withAgentDisplayIdentity(agent: WorkforceAgent): WorkforceAgent {
  if (validAgentDisplayName(agent.displayName) && agent.displayNameSource !== undefined)
    return agent;
  return {
    ...agent,
    displayName: generateAgentDisplayName(agent.agentId),
    displayNameSource: "legacy_derived",
  };
}
