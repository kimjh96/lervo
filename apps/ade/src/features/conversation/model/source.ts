/**
 * What the conversation view drives: a live session, or the work being started before its
 * session exists. Each kind is one strategy, so the view never branches on it.
 */
export interface ConversationSource {
  /** Shows the conversation's window and starts following it. */
  open(): Promise<void>;
  close(): void;
  /** Sends a reply; it resolves once the provider received it and rejects with the failure. */
  send(text: string): Promise<void>;
  /**
   * Stops the running turn and keeps the session; it resolves once the provider received the
   * request, and the turn's end follows as status.
   */
  interrupt(): Promise<void>;
  loadEarlier(): Promise<void>;
  loadLater(): Promise<void>;
  showLatest(): Promise<void>;
}
