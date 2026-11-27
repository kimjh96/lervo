/** A file a person attaches by path, as the shell describes it. */
export interface AttachedFile {
  readonly path: string;
  readonly name: string;
  /** The size in bytes of a file; null for a folder or a missing file. */
  readonly size: number | null;
  readonly directory: boolean;
  /** Whether the path still names a file or folder. */
  readonly exists: boolean;
}

/** Files dragged over the window: their arrival, their departure, or their drop with paths. */
export type FileDrag =
  | { readonly kind: "enter" }
  | { readonly kind: "leave" }
  | { readonly kind: "drop"; readonly paths: readonly string[] };

/**
 * Files attached to a message by path (Lervo ADE sessions, "Files in a message"). The webview
 * never learns a file's path, so the shell reads them.
 */
export interface Files {
  /** The files on the system clipboard, such as those copied in Finder. */
  pasted(): Promise<AttachedFile[]>;
  /** Each path as a file, in order; a missing path comes back with `exists` false. */
  describe(paths: readonly string[]): Promise<AttachedFile[]>;
  /** The bytes of a dropped image file; rejects when it cannot be read or is too large. */
  readImage(path: string): Promise<Blob>;
  /** Shows a file in Finder, selected in its folder. */
  reveal(path: string): void;
  /** Opens a folder itself in Finder, such as a project's, rather than its parent. */
  openFolder(path: string): void;
  /** Calls `listener` for each drag of files over the window until the returned function runs. */
  watchDrags(listener: (drag: FileDrag) => void): () => void;
}
