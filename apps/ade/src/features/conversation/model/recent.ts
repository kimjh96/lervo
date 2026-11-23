import type { ConversationItem } from "@lervo/session-host-contract";

import type { ConversationWindow } from "./window";

/** What the kept windows may hold at most, estimated from their text. */
const BUDGET_BYTES = 8 * 1024 * 1024;
/** What an item costs besides its text: identifiers, times, and object overhead. */
const ITEM_BYTES = 256;

function textOf(item: ConversationItem): string {
  return "text" in item ? item.text : "";
}

/** The estimated memory of a window: two bytes per UTF-16 code unit of text, plus overhead. */
export function windowBytes(window: ConversationWindow): number {
  let bytes = 0;
  for (const item of window.items) bytes += ITEM_BYTES + textOf(item).length * 2;
  return bytes;
}

/**
 * Windows of conversations that closed recently, so reopening one shows it at once. It is an LRU
 * cache bounded by estimated bytes (ADE performance, "Caches are LRU by bytes"): remembering a
 * window forgets the least recently remembered ones until the rest fit.
 */
export class RecentWindows {
  private readonly windows = new Map<string, { window: ConversationWindow; bytes: number }>();
  private total = 0;

  constructor(private readonly budget = BUDGET_BYTES) {}

  get(sessionId: string): ConversationWindow | undefined {
    return this.windows.get(sessionId)?.window;
  }

  remember(sessionId: string, window: ConversationWindow): void {
    this.forget(sessionId);
    const bytes = windowBytes(window);
    if (window.items.length === 0 || bytes > this.budget) return;
    this.windows.set(sessionId, { window, bytes });
    this.total += bytes;
    for (const oldest of this.windows.keys()) {
      if (this.total <= this.budget) break;
      this.forget(oldest);
    }
  }

  private forget(sessionId: string): void {
    const kept = this.windows.get(sessionId);
    if (kept === undefined) return;
    this.windows.delete(sessionId);
    this.total -= kept.bytes;
  }
}
