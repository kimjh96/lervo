import type { ConversationItem } from "@lervo/session-host-contract";

/** Items the interface keeps at once; the rest stay in the session host's index. */
export const MAX_WINDOW_ITEMS = 600;
/** Items in one page request. */
export const PAGE_ITEMS = 100;

/** A bounded, ordered slice of one conversation, and whether more exists on either side. */
export interface ConversationWindow {
  readonly items: readonly ConversationItem[];
  readonly hasEarlier: boolean;
  readonly hasLater: boolean;
}

export const emptyWindow: ConversationWindow = { items: [], hasEarlier: false, hasLater: false };

function replaceKnown(
  items: readonly ConversationItem[],
  incoming: readonly ConversationItem[],
): { items: ConversationItem[]; fresh: ConversationItem[] } {
  const index = new Map(items.map((item, position) => [item.itemId, position]));
  const next = [...items];
  const fresh: ConversationItem[] = [];
  for (const item of incoming) {
    const position = index.get(item.itemId);
    if (position === undefined) fresh.push(item);
    else next[position] = item;
  }
  return { items: next, fresh };
}

/** Applies a `conversation.page`. Pages extend the window on their side; the far side trims. */
export function applyPage(
  window: ConversationWindow,
  page: { items: readonly ConversationItem[]; hasEarlier: boolean; hasLater: boolean },
  side: "latest" | "before" | "after",
): ConversationWindow {
  if (side === "latest")
    return trim(
      { items: [...page.items], hasEarlier: page.hasEarlier, hasLater: page.hasLater },
      "end",
    );
  const { items, fresh } = replaceKnown(window.items, page.items);
  return side === "before"
    ? trim(
        { items: [...fresh, ...items], hasEarlier: page.hasEarlier, hasLater: window.hasLater },
        "start",
      )
    : trim(
        { items: [...items, ...fresh], hasEarlier: window.hasEarlier, hasLater: page.hasLater },
        "end",
      );
}

/**
 * Applies `conversation.appended`. A known item is replaced, which is how a streaming item
 * completes. A new item joins only while the window reaches the live end; otherwise the user is
 * reading history, and the item arrives with the next page.
 */
export function applyAppended(
  window: ConversationWindow,
  incoming: readonly ConversationItem[],
): ConversationWindow {
  const { items, fresh } = replaceKnown(window.items, incoming);
  if (window.hasLater || fresh.length === 0) return { ...window, items };
  return trim({ ...window, items: [...items, ...fresh] }, "end");
}

/** Applies streamed text to the item it extends, if the window holds it. */
export function applyDelta(
  window: ConversationWindow,
  itemId: string,
  text: string,
): ConversationWindow {
  const position = window.items.findIndex((item) => item.itemId === itemId);
  const item = window.items[position];
  if (item === undefined || !("text" in item)) return window;
  const items = [...window.items];
  items[position] = { ...item, text: item.text + text };
  return { ...window, items };
}

/** Keeps at most `MAX_WINDOW_ITEMS`, dropping from the side away from `keep`. */
function trim(window: ConversationWindow, keep: "start" | "end"): ConversationWindow {
  const excess = window.items.length - MAX_WINDOW_ITEMS;
  if (excess <= 0) return window;
  return keep === "end"
    ? { ...window, items: window.items.slice(excess), hasEarlier: true }
    : { ...window, items: window.items.slice(0, MAX_WINDOW_ITEMS), hasLater: true };
}
