import { resolve } from "node:path";
import type { EventDraftV7 } from "@lervo/event-contract";
import { validateSchema } from "@lervo/schemas";
import { readPrivateJsonFile, writePrivateJsonFile } from "./private-state-file.js";

const PATH = ".lervo/state/knowledge/terminal-skills/observations.json";
const MAXIMUM_BYTES = 2 * 1024 * 1024;
interface PrivateTurn {
  contextEventId: string;
  observedAt: string;
  events: EventDraftV7[];
}

/** Lossy host-private evidence while canonical event readers await activation. Never synced. */
export async function privateTerminalSkillTurns(root: string, now: Date): Promise<PrivateTurn[]> {
  const read = await readPrivateJsonFile(resolve(root, PATH), MAXIMUM_BYTES);
  if (read.status !== "read" || !Array.isArray(read.value) || read.value.length > 128) return [];
  return (read.value as PrivateTurn[]).filter(
    (turn) =>
      turn &&
      /^evt_[A-Za-z0-9_-]{8,64}$/u.test(turn.contextEventId) &&
      Date.parse(turn.observedAt) >= now.getTime() - 30 * 86_400_000 &&
      Date.parse(turn.observedAt) <= now.getTime() &&
      Array.isArray(turn.events) &&
      turn.events.length <= 1025 &&
      turn.events.every(
        (event) =>
          (event.type === "terminal.skill.observed" ||
            event.type === "terminal.skill.turn_assessed") &&
          validateSchema(
            event.type === "terminal.skill.observed"
              ? "terminalSkillObservedEventPayload"
              : "terminalSkillTurnAssessedEventPayload",
            event.payload,
          ).valid,
      ),
  );
}

export async function retainPrivateTerminalSkillTurn(
  root: string,
  turn: PrivateTurn,
  now: Date,
): Promise<void> {
  const turns = (await privateTerminalSkillTurns(root, now)).filter(
    (old) => old.contextEventId !== turn.contextEventId,
  );
  turns.push(turn);
  turns.sort((a, b) => a.observedAt.localeCompare(b.observedAt));
  while (
    turns.length > 128 ||
    Buffer.byteLength(JSON.stringify(turns, null, 2)) + 1 > MAXIMUM_BYTES
  )
    turns.shift();
  await writePrivateJsonFile(resolve(root, PATH), turns);
}
