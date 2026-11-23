/** Text the user typed and has not sent, kept across reloads and restarts by key. */
export interface Drafts {
  read(key: string): string;
  /** Stores the text; an empty text forgets the key. */
  write(key: string, text: string): void;
}
