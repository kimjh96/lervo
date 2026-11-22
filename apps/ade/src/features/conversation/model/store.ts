import { create } from "zustand";

import { type ConversationWindow, emptyWindow } from "./window";

interface ConversationStore {
  /** The session the open conversation shows, or null before it opens. */
  readonly sessionId: string | null;
  readonly window: ConversationWindow;
  readonly loadingEarlier: boolean;
  /** Items that arrived while the user watched; only these animate (ADE motion). */
  readonly arrived: ReadonlySet<string>;
  readonly error: string | null;
}

export const useConversationStore = create<ConversationStore>(() => ({
  sessionId: null,
  window: emptyWindow,
  loadingEarlier: false,
  arrived: new Set(),
  error: null,
}));
