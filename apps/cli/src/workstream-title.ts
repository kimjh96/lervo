import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const MAX_WORKSTREAM_BYTES = 64 * 1024;

/** A conversation's title: the workstream title in its worktree, or null when it is unreadable. */
export async function workstreamTitle(worktree: string): Promise<string | null> {
  try {
    const path = resolve(worktree, ".lervo/state/workstreams/current.json");
    const content = await readFile(path, "utf8");
    if (content.length > MAX_WORKSTREAM_BYTES) return null;
    const title = (JSON.parse(content) as { title?: unknown }).title;
    return typeof title === "string" ? title : null;
  } catch {
    return null;
  }
}
