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
  loadEarlier(): Promise<void>;
  loadLater(): Promise<void>;
  showLatest(): Promise<void>;
}
