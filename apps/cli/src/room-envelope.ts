// The turn a mention delivers to an agent (Lervo ADE rooms, "Routing"), and reading it back.

/** One earlier turn of the conversation, as the delivered turn recalls it. */
export interface RoomTurn {
  readonly speaker: string;
  readonly text: string;
}

/** What a delivered turn carries: who mentioned the agent, the message, and what came before. */
export interface RoomEnvelope {
  readonly from: string;
  readonly role: string;
  readonly message: string;
  readonly recent: readonly RoomTurn[];
  /**
   * Why the turn came: a mention, the answer to the agent's own mention, the first turn of a
   * conversation the agent started for its own work, or of one a teammate handed it (ADR-0657).
   */
  readonly reason: "mention" | "answer" | "start" | "handed";
}

const MARK = "[Lervo room]";
const RECENT_TURNS = 8;
const RECENT_BYTES = 16 * 1024;
const FIRST_LINE = /^\[Lervo room\] (?:From|Answer from) (.+) \((.+)\):$/u;

/** The most recent turns that fit the bound, oldest first. */
function recentWithin(turns: readonly RoomTurn[]): RoomTurn[] {
  const kept: RoomTurn[] = [];
  let bytes = 0;
  for (const turn of turns.slice(-RECENT_TURNS).toReversed()) {
    const size = Buffer.byteLength(turn.speaker) + Buffer.byteLength(turn.text);
    if (bytes + size > RECENT_BYTES) break;
    bytes += size;
    kept.unshift(turn);
  }
  return kept;
}

/**
 * The text a mention delivers. Its first line names the sender, so a transcript read back shows
 * the turn as the sender's message, never the owner's; the rest recalls the conversation since the
 * agent last spoke and says how answers and mentions work.
 */
export function envelopeText(envelope: RoomEnvelope): string {
  const head =
    envelope.reason === "answer"
      ? `${MARK} Answer from ${envelope.from} (${envelope.role}):`
      : `${MARK} From ${envelope.from} (${envelope.role}):`;
  const recent = recentWithin(envelope.recent);
  const recalled =
    recent.length === 0
      ? ""
      : `\n\n${MARK} Earlier in this conversation:\n${recent
          .map((turn) => `- ${turn.speaker}: ${turn.text.replace(/\s+/gu, " ").trim()}`)
          .join("\n")}`;
  const guide =
    envelope.reason === "answer"
      ? `\n\n${MARK} Continue your work with this answer.`
      : envelope.reason === "start"
        ? `\n\n${MARK} You started this conversation for this work, and you lead it. Work here; mention @Name only when your work needs that agent's role or knowledge.`
        : envelope.reason === "handed"
          ? `\n\n${MARK} ${envelope.from} started this conversation for your work and handed it to you: you lead it and change the files here. Do the work yourself; mention @${envelope.from} when you need it or when the work is done, and @Name for another agent's role or knowledge.`
          : `\n\n${MARK} Answer here; your answer returns to ${envelope.from}. Mention @Name only when your work needs that agent's role or knowledge.`;
  return `${head}\n${envelope.message.trim()}${recalled}${guide}`;
}

/** The sender and message of a delivered turn, or null for any other text. */
export function readEnvelope(text: string): { from: string; message: string } | null {
  const newline = text.indexOf("\n");
  if (newline < 0) return null;
  const first = FIRST_LINE.exec(text.slice(0, newline));
  if (first === null) return null;
  const rest = text.slice(newline + 1);
  const end = rest.indexOf(`\n\n${MARK} `);
  return { from: first[1] as string, message: end < 0 ? rest : rest.slice(0, end) };
}
