import type { ImageMark } from "@lervo/session-host-contract";

import { RequestFailure } from "../../../ports";
import type { ConversationSource } from "./source";
import { standInWindow } from "./stand-in";
import { useConversationStore } from "./store";

/**
 * The conversation of work just sent, while the core creates its workspace: the instruction as
 * the first message, and nothing to load or send yet. The session's conversation continues it
 * with the same stand-in, so the view does not change when the workspace exists.
 */
export class StandInConversation implements ConversationSource {
  constructor(
    private readonly firstMessage: string,
    private readonly now: () => number = Date.now,
    private readonly firstImages: readonly ImageMark[] = [],
  ) {}

  async open(): Promise<void> {
    useConversationStore.setState({
      sessionId: null,
      window: standInWindow(this.firstMessage, this.now(), this.firstImages),
      loadingEarlier: false,
      loadingLater: false,
      arrived: new Set(),
      error: null,
    });
  }

  close(): void {}

  send(): Promise<void> {
    return Promise.reject(new RequestFailure("session_not_started"));
  }

  interrupt(): Promise<void> {
    return Promise.reject(new RequestFailure("session_not_started"));
  }

  /** The work's own images are in the cache already; the session host keeps none yet. */
  readImage(): Promise<string> {
    return Promise.reject(new RequestFailure("image_not_found"));
  }

  async loadEarlier(): Promise<void> {}

  async loadLater(): Promise<void> {}

  async showLatest(): Promise<void> {}
}
