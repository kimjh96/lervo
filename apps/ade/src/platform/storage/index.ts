import type { Drafts } from "../../ports/drafts";

const PREFIX = "lervo.draft.";
/** Drafts kept at most; storing another forgets the one written longest ago. */
const MAX_DRAFTS = 64;
/** The longest draft kept, in UTF-16 code units; longer text keeps its first part. */
const MAX_DRAFT_LENGTH = 64 * 1024;
/** How long typing pauses before its draft is stored, so keystrokes do not each write. */
const SAVE_AFTER_MS = 400;

interface Entry {
  readonly text: string;
  readonly writtenAt: number;
}

function parse(value: string | null): Entry | null {
  if (value === null) return null;
  try {
    const entry: unknown = JSON.parse(value);
    if (entry === null || typeof entry !== "object") return null;
    const { text, writtenAt } = entry as Record<string, unknown>;
    return typeof text === "string" && typeof writtenAt === "number" ? { text, writtenAt } : null;
  } catch {
    return null;
  }
}

/**
 * Drafts in the webview's local storage, which persists with the app's data (ADE quality, "No
 * user input is lost"). Writes are coalesced: a draft is stored once typing pauses, and every
 * unsaved draft is stored when the page hides or unloads. At most 64 drafts of at most 64 Ki code
 * units each are kept. A storage that refuses a write, for example because it is full, keeps the
 * previous draft. Returns the drafts and the function that stops saving.
 */
export function localDrafts(
  storage: Storage = localStorage,
  options: {
    readonly now?: () => number;
    readonly schedule?: (run: () => void, ms: number) => ReturnType<typeof setTimeout>;
    readonly cancel?: (timer: ReturnType<typeof setTimeout>) => void;
    readonly page?: Pick<Window, "addEventListener" | "removeEventListener"> | null;
  } = {},
): Drafts & { dispose(): void } {
  const now = options.now ?? Date.now;
  const schedule = options.schedule ?? setTimeout;
  const cancel = options.cancel ?? clearTimeout;
  const page = options.page === undefined ? globalThis : options.page;
  const unsaved = new Map<string, string>();
  let timer: ReturnType<typeof setTimeout> | undefined;

  const trim = () => {
    const stored: { key: string; writtenAt: number }[] = [];
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (key?.startsWith(PREFIX) === true)
        stored.push({ key, writtenAt: parse(storage.getItem(key))?.writtenAt ?? 0 });
    }
    stored.sort((left, right) => left.writtenAt - right.writtenAt);
    for (const { key } of stored.slice(0, Math.max(0, stored.length - MAX_DRAFTS)))
      storage.removeItem(key);
  };
  const store = (key: string, text: string) => {
    try {
      if (text.length === 0) {
        storage.removeItem(PREFIX + key);
        return;
      }
      const fresh = storage.getItem(PREFIX + key) === null;
      const entry: Entry = { text: text.slice(0, MAX_DRAFT_LENGTH), writtenAt: now() };
      storage.setItem(PREFIX + key, JSON.stringify(entry));
      if (fresh) trim();
    } catch {
      // A full or unavailable storage keeps the previous draft; the text stays in the input.
    }
  };
  const flush = () => {
    if (timer !== undefined) cancel(timer);
    timer = undefined;
    for (const [key, text] of unsaved) store(key, text);
    unsaved.clear();
  };
  page?.addEventListener("pagehide", flush);
  page?.addEventListener("visibilitychange", flush);

  return {
    read: (key) => unsaved.get(key) ?? parse(storage.getItem(PREFIX + key))?.text ?? "",
    write(key, text) {
      unsaved.set(key, text);
      if (timer !== undefined) cancel(timer);
      timer = schedule(flush, SAVE_AFTER_MS);
    },
    dispose() {
      flush();
      page?.removeEventListener("pagehide", flush);
      page?.removeEventListener("visibilitychange", flush);
    },
  };
}

export { localLists } from "./lists";
export { localProjects } from "./projects";
