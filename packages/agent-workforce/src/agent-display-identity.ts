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

/**
 * The name a hire without one gets (ADR-0662): a person-like nickname, such as "Bora", that no
 * agent of the project has yet, starting where the agent's ID points. When every nickname is
 * taken, the nickname with the ID's last four characters, as older hires were named.
 */
export function availableAgentNickname(agentId: string, taken: readonly string[]): string {
  const used = (name: string) =>
    taken.some(
      (existing) => existing.localeCompare(name, undefined, { sensitivity: "accent" }) === 0,
    );
  const start = Number.parseInt(agentId.slice(4, 6), 16) % AGENT_DISPLAY_NAMES.length;
  for (let offset = 0; offset < AGENT_DISPLAY_NAMES.length; offset += 1) {
    const name = AGENT_DISPLAY_NAMES[(start + offset) % AGENT_DISPLAY_NAMES.length]!;
    if (!used(name)) return name;
  }
  return generateAgentDisplayName(agentId);
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
