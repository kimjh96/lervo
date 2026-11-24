/** The system clipboard: text the person asked to copy, such as a branch name. */
export interface Clipboard {
  /** Rejects when the system refuses the write. */
  copy(text: string): Promise<void>;
}
