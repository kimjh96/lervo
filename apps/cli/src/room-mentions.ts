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
