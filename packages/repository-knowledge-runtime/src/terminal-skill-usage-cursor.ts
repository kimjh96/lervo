import { resolve } from "node:path";

import type { OutboxStore } from "@lervo/storage-contract";

import { readPrivateJsonFile, writePrivateJsonFile } from "./private-state-file.js";

export const TERMINAL_SKILL_USAGE_CURSOR_PATH =
  ".lervo/state/knowledge/terminal-skills/usage-cursor.json";

/**
 * ADR-0597: where the last usage projection stood. `sourceKey` names its inputs; `anchor` is the
 * last skill event before the 30-day window, so the next read starts after it. The window only
 * moves forward, so no event at or before the anchor can enter it again.
 */
export interface TerminalSkillUsageCursor {
  schemaVersion: 1;
  sourceKey: string;
  anchor: { seq: number; eventId: string } | null;
}

function validCursor(value: unknown): value is TerminalSkillUsageCursor {
  const cursor = value as Partial<TerminalSkillUsageCursor> | null;
  return (
    cursor !== null &&
    typeof cursor === "object" &&
    cursor.schemaVersion === 1 &&
    typeof cursor.sourceKey === "string" &&
    (cursor.anchor === null ||
      (typeof cursor.anchor === "object" &&
        cursor.anchor !== undefined &&
        Number.isSafeInteger(cursor.anchor.seq) &&
        cursor.anchor.seq > 0 &&
        typeof cursor.anchor.eventId === "string"))
  );
}

/** The saved cursor, or null when it is missing, invalid, or its anchor is not in this log. */
export async function readTerminalSkillUsageCursor(
  root: string,
  events: Pick<OutboxStore, "get">,
): Promise<TerminalSkillUsageCursor | null> {
  const read = await readPrivateJsonFile(resolve(root, TERMINAL_SKILL_USAGE_CURSOR_PATH), 4096);
  if (read.status !== "read" || !validCursor(read.value)) return null;
  const anchor = read.value.anchor;
  if (anchor !== null && events.get(anchor.eventId)?.seq !== anchor.seq) return null;
  return read.value;
}

export async function writeTerminalSkillUsageCursor(
  root: string,
  cursor: TerminalSkillUsageCursor,
): Promise<void> {
  await writePrivateJsonFile(resolve(root, TERMINAL_SKILL_USAGE_CURSOR_PATH), cursor);
}
