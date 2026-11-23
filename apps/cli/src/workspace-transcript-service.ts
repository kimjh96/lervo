// The provider transcript of a workspace's hosted session, in pages, for the session host that
// rebuilds the native conversation's index from it (core-link protocol, `transcript.read`).
import { hasTranscriptReader, type HostedTranscriptItem } from "@lervo/adapter-contract";

import { locateWorkspaceSession } from "./workspace-launch-service.js";

/** Bytes of item text in one page at most, so a page stays far below a core-link line's bound. */
export const MAX_PAGE_TEXT_BYTES = 4 * 1024 * 1024;
/** Readers kept between pages; a session host reads one transcript at a time. */
const MAX_CURSORS = 4;

interface Cursor {
  readonly workspaceId: string;
  readonly items: AsyncIterator<HostedTranscriptItem>;
  /** An item read past the previous page's bound. */
  held: HostedTranscriptItem | undefined;
  offset: number;
}

export interface TranscriptPage {
  items: HostedTranscriptItem[];
  complete: boolean;
}

function textBytes(item: HostedTranscriptItem): number {
  return "text" in item.content ? Buffer.byteLength(item.content.text) : 0;
}

/**
 * Reads transcript pages in order. A request that continues the previous page resumes its reader,
 * so reading a transcript page by page reads its file once.
 */
export class WorkspaceTranscripts {
  private readonly cursors: Cursor[] = [];

  constructor(
    private readonly open: (
      workspaceId: string,
    ) => Promise<AsyncIterator<HostedTranscriptItem> | null> = openTranscript,
  ) {}

  async read(workspaceId: string, offset: number, limit: number): Promise<TranscriptPage> {
    const cursor = await this.cursor(workspaceId, offset);
    if (cursor === null) return { items: [], complete: true };
    const items: HostedTranscriptItem[] = [];
    let bytes = 0;
    for (;;) {
      const next = cursor.held ?? (await cursor.items.next()).value;
      cursor.held = undefined;
      if (next === undefined) {
        this.forget(cursor);
        return { items, complete: true };
      }
      const size = textBytes(next);
      if (items.length >= limit || (items.length > 0 && bytes + size > MAX_PAGE_TEXT_BYTES)) {
        cursor.held = next;
        cursor.offset += items.length;
        return { items, complete: false };
      }
      items.push(next);
      bytes += size;
    }
  }

  private async cursor(workspaceId: string, offset: number): Promise<Cursor | null> {
    const kept = this.cursors.find(
      (cursor) => cursor.workspaceId === workspaceId && cursor.offset === offset,
    );
    if (kept !== undefined) return kept;
    const items = await this.open(workspaceId);
    if (items === null) return null;
    const cursor: Cursor = { workspaceId, items, held: undefined, offset: 0 };
    for (let skipped = 0; skipped < offset; skipped += 1)
      if ((await items.next()).done === true) return { ...cursor, offset };
    cursor.offset = offset;
    this.cursors.push(cursor);
    while (this.cursors.length > MAX_CURSORS) this.forget(this.cursors[0] as Cursor);
    return cursor;
  }

  private forget(cursor: Cursor): void {
    const index = this.cursors.indexOf(cursor);
    if (index !== -1) this.cursors.splice(index, 1);
    void cursor.items.return?.();
  }
}

/** The workspace session's transcript reader, or `null` when its provider keeps none. */
async function openTranscript(
  workspaceId: string,
): Promise<AsyncIterator<HostedTranscriptItem> | null> {
  const { previous, workingDirectory, adapter } = await locateWorkspaceSession(workspaceId);
  if (!hasTranscriptReader(adapter)) return null;
  return adapter
    .readTranscript({ sessionId: previous.sessionId, workingDirectory })
    [Symbol.asyncIterator]();
}
