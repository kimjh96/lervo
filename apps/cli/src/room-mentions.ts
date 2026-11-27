// Mentions in a conversation's turns (Lervo ADE rooms, "Routing").
import type { TeamAgent } from "./workspace-participants.js";

/** Fenced code blocks, then inline code spans: a mention inside code stays text. */
const CODE = /```[\s\S]*?(?:```|$)|`[^`\n]*`/gu;

function escaped(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

/**
 * The agents a text mentions, in the order the text first mentions them: `@` and an agent's
 * display name, without regard to case, at a word boundary and outside code. A longer name wins
 * over a shorter one it begins with, so `@Arin-92AE` never mentions Arin.
 */
export function mentionedAgents(
  text: string,
  agents: readonly Pick<TeamAgent, "agentId" | "displayName">[],
): string[] {
  const prose = text.replace(CODE, (code) => " ".repeat(code.length));
  const taken = new Set<number>();
  const found: { agentId: string; at: number }[] = [];
  const longestFirst = [...agents].sort((a, b) => b.displayName.length - a.displayName.length);
  for (const agent of longestFirst) {
    const pattern = new RegExp(
      `(?<![\\p{L}\\p{N}_@])@${escaped(agent.displayName)}(?![\\p{L}\\p{N}_-])`,
      "giu",
    );
    for (const match of prose.matchAll(pattern)) {
      if (taken.has(match.index)) continue;
      taken.add(match.index);
      if (!found.some((item) => item.agentId === agent.agentId))
        found.push({ agentId: agent.agentId, at: match.index });
    }
  }
  return found.sort((a, b) => a.at - b.at).map((item) => item.agentId);
}

/**
 * Who an agent's finished turn reaches: the agents it mentioned, and the agents waiting for its
 * answer. Naming an agent that asked is the answer to it, never a new question back. A turn that
 * asks another agent first keeps the other answers owed; the turn that asks no one answers
 * everyone still waiting. `settled` names the answers the turn gave.
 */
export function turnTargets(
  mentioned: readonly string[],
  owed: ReadonlySet<string>,
): { targets: { agentId: string; reason: "mention" | "answer" }[]; settled: string[] } {
  const answered = mentioned.filter((id) => owed.has(id));
  const asked = mentioned.filter((id) => !owed.has(id));
  const waiting = asked.length > 0 ? [] : [...owed].filter((id) => !answered.includes(id));
  const settled = [...answered, ...waiting];
  return {
    targets: [
      ...asked.map((agentId) => ({ agentId, reason: "mention" as const })),
      ...settled.map((agentId) => ({ agentId, reason: "answer" as const })),
    ],
    settled,
  };
}
