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
  ) {}

  async open(): Promise<void> {
    useConversationStore.setState({
      sessionId: null,
      window: standInWindow(this.firstMessage, this.now()),
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

  async loadEarlier(): Promise<void> {}

  async loadLater(): Promise<void> {}

  async showLatest(): Promise<void> {}
}
