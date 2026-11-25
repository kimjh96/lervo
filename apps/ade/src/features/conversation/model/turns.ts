import type { ConversationItem } from "@lervo/session-host-contract";

/** A turn as the conversation names it: when its message was sent, and when the next one was. */
export interface TurnWindow {
  readonly startedAtMs: number;
  readonly endedAtMs?: number;
}

export interface TurnEnd {
  /** The item ID of the message that started the turn. */
  readonly turn: string;
  readonly window: TurnWindow;
  /** How long the turn took, from its message to its last item. */
  readonly elapsedMs: number;
}

/**
 * Where each finished turn ends, by item index: a turn starts at a message the user sent and ends
 * at the item before the next one, or at the last item once the agent stopped working.
 */
export function turnEnds(
  items: readonly ConversationItem[],
  turnOpen: boolean,
): ReadonlyMap<number, TurnEnd> {
  const ends = new Map<number, TurnEnd>();
  let start: ConversationItem | undefined;
  items.forEach((item, index) => {
    if (item.kind === "user_message") {
      start = item;
      return;
    }
    const next = items[index + 1];
    if (start === undefined || (next === undefined ? turnOpen : next.kind !== "user_message"))
      return;
    ends.set(index, {
      turn: start.itemId,
      elapsedMs: item.createdAtMs - start.createdAtMs,
      window:
        next === undefined
          ? { startedAtMs: start.createdAtMs }
          : { startedAtMs: start.createdAtMs, endedAtMs: next.createdAtMs },
    });
  });
  return ends;
}

/**
 * The replies sent at or after `since` that the agent has not answered yet: Claude Code reads a
 * reply sent during a turn between the turn's steps, so a reply waits until the agent's next item.
 */
export function queuedReplies(
  items: readonly ConversationItem[],
  since: number | null,
): ReadonlySet<string> {
  const waiting = new Set<string>();
  if (since === null) return waiting;
  for (const item of items) {
    if (item.kind === "user_message") {
      if (item.createdAtMs >= since) waiting.add(item.itemId);
    } else if (item.kind !== "lervo_notice") waiting.clear();
  }
  return waiting;
}
