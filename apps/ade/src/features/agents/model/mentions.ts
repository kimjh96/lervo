// Mentions in a conversation's text, as the core reads them (Lervo ADE rooms, "Routing").

/** A piece of text: plain, or a mention of one of the team's agents. */
export type MentionPart = string | { readonly agentId: string; readonly name: string };

function escaped(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

/**
 * The text with each mention of a team agent apart: `@` and the agent's display name, without
 * regard to case, at a word boundary. A longer name wins over a shorter one it begins with, as the
 * core decides, so the interface marks exactly the mentions the core delivers.
 */
export function mentionParts(
  text: string,
  agents: readonly { agentId: string; displayName: string }[],
): MentionPart[] {
  if (agents.length === 0 || !text.includes("@")) return [text];
  const names = [...agents].sort((a, b) => b.displayName.length - a.displayName.length);
  const pattern = new RegExp(
    `(?<![\\p{L}\\p{N}_@])@(${names.map((agent) => escaped(agent.displayName)).join("|")})(?![\\p{L}\\p{N}_-])`,
    "giu",
  );
  const parts: MentionPart[] = [];
  let at = 0;
  for (const match of text.matchAll(pattern)) {
    const agent = names.find(
      (candidate) => candidate.displayName.toLowerCase() === (match[1] ?? "").toLowerCase(),
    );
    if (agent === undefined) continue;
    if (match.index > at) parts.push(text.slice(at, match.index));
    parts.push({ agentId: agent.agentId, name: match[0] });
    at = match.index + match[0].length;
  }
  if (at < text.length) parts.push(text.slice(at));
  return parts;
}
