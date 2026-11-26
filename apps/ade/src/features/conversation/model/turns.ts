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

/** Whether `item` asked with choices, so the person's next message answers it within the turn. */
function asksWithChoices(item: ConversationItem | undefined): boolean {
  return item?.kind === "question" && item.choices !== undefined;
}

/**
 * Where each finished turn ends, by item index: a turn starts at a message the user sent and ends
 * at the item before the next one, or at the last item once the agent stopped working. The answer
 * to a question with choices goes on with the turn that asked it.
 */
export function turnEnds(
  items: readonly ConversationItem[],
  turnOpen: boolean,
): ReadonlyMap<number, TurnEnd> {
  const ends = new Map<number, TurnEnd>();
  let start: ConversationItem | undefined;
  items.forEach((item, index) => {
    if (item.kind === "user_message") {
      if (!asksWithChoices(items[index - 1])) start = item;
      return;
    }
    const next = items[index + 1];
    const finished =
      next === undefined ? !turnOpen : next.kind === "user_message" && !asksWithChoices(item);
    if (start === undefined || !finished) return;
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
