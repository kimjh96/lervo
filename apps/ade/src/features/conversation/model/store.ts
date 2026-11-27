import { create } from "zustand";

import { type ConversationWindow, emptyWindow } from "./window";

interface ConversationStore {
  /** The session the open conversation shows, or null before it opens. */
  readonly sessionId: string | null;
  readonly window: ConversationWindow;
  readonly loadingEarlier: boolean;
  readonly loadingLater: boolean;
  /** Items that arrived while the user watched; only these animate (ADE motion). */
  readonly arrived: ReadonlySet<string>;
  /**
   * When the text the last frame added to each streaming item reached the page, by item. The
   * pacer counts its time from then rather than from the frame that rendered it.
   */
  readonly grownAt: Readonly<Record<string, number>>;
  readonly error: string | null;
}

export const useConversationStore = create<ConversationStore>(() => ({
  sessionId: null,
  window: emptyWindow,
  loadingEarlier: false,
  loadingLater: false,
  arrived: new Set(),
  grownAt: {},
  error: null,
}));
