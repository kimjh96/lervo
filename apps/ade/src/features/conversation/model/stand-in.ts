import type { ImageMark } from "@lervo/session-host-contract";

import type { ConversationWindow } from "./window";

/** The item that stands in for the first message until the session reports it. */
export const FIRST_MESSAGE_ID = "first-message";

/**
 * A window with only the instruction that started the work, with the images pasted with it, as
 * the user's first message.
 */
export function standInWindow(
  text: string,
  now: number,
  images: readonly ImageMark[] = [],
): ConversationWindow {
  return {
    items: [
      {
        kind: "user_message",
        itemId: FIRST_MESSAGE_ID,
        createdAtMs: now,
        state: "complete",
        text,
        ...(images.length === 0 ? {} : { images: [...images] }),
      },
    ],
    hasEarlier: false,
    hasLater: false,
  };
}
