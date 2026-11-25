import type { SentImage } from "@lervo/session-host-contract";

/**
 * What the conversation view drives: a live session, or the work being started before its
 * session exists. Each kind is one strategy, so the view never branches on it.
 */
export interface ConversationSource {
  /** Shows the conversation's window and starts following it. */
  open(): Promise<void>;
  close(): void;
  /**
   * Sends a reply, with the images it carries; it resolves once the provider received it and
   * rejects with the failure.
   */
  send(text: string, images?: readonly SentImage[]): Promise<void>;
  /**
   * Stops the running turn and keeps the session; it resolves once the provider received the
   * request, and the turn's end follows as status.
   */
  interrupt(): Promise<void>;
  /**
   * The bytes of an image a message in this conversation carried, as a data URL; it rejects with
   * `image_not_found` when the session host keeps no such image.
   */
  readImage(imageId: string): Promise<string>;
  loadEarlier(): Promise<void>;
  loadLater(): Promise<void>;
  showLatest(): Promise<void>;
}
