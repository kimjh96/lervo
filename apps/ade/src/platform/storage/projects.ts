import type { ProjectMemory } from "../../ports/project-memory";

const SELECTED_KEY = "lervo.project";
const MARKS_KEY = "lervo.marks";
/** Mark copies kept at most; keeping another forgets the one kept longest ago. */
const MAX_MARKS = 64;
/** The longest mark copy kept, in UTF-16 code units: a thumbnail, never the full image. */
const MAX_MARK_URL = 64 * 1024;

interface Kept {
  readonly sha256: string;
  readonly url: string;
}

const isKept = (value: unknown): value is Kept => {
  if (value === null || typeof value !== "object") return false;
  const { sha256, url } = value as Record<string, unknown>;
  return (
    typeof sha256 === "string" &&
    /^[0-9a-f]{64}$/u.test(sha256) &&
    typeof url === "string" &&
    url.startsWith("data:image/") &&
    url.length <= MAX_MARK_URL
  );
};

/**
 * The selected project and mark thumbnails in the webview's local storage (Lervo ADE projects).
 * Unreadable or foreign values read as nothing kept; a refused write keeps the previous value.
 */
export function localProjects(storage: Storage = localStorage): ProjectMemory {
  const read = (): Kept[] => {
    try {
      const value: unknown = JSON.parse(storage.getItem(MARKS_KEY) ?? "[]");
      return Array.isArray(value) ? value.filter(isKept).slice(-MAX_MARKS) : [];
    } catch {
      return [];
    }
  };
  const write = (key: string, value: string) => {
    try {
      storage.setItem(key, value);
    } catch {
      // Full or refused: the previous value stays, and the core answers again next time.
    }
  };
  return {
    selected: () => storage.getItem(SELECTED_KEY),
    select: (projectId) => write(SELECTED_KEY, projectId),
    marks: () => Object.fromEntries(read().map((kept) => [kept.sha256, kept.url])),
    keepMark(sha256, url) {
      const kept = { sha256, url };
      if (!isKept(kept)) return;
      const next = [...read().filter((item) => item.sha256 !== sha256), kept].slice(-MAX_MARKS);
      write(MARKS_KEY, JSON.stringify(next));
    },
  };
}
