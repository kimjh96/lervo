import type { ConversationWindow } from "./window";

/** The item that stands in for the first message until the session reports it. */
export const FIRST_MESSAGE_ID = "first-message";

/** A window with only the instruction that started the work, as the user's first message. */
export function standInWindow(text: string, now: number): ConversationWindow {
  return {
    items: [
      { kind: "user_message", itemId: FIRST_MESSAGE_ID, createdAtMs: now, state: "complete", text },
    ],
    hasEarlier: false,
    hasLater: false,
  };
}
