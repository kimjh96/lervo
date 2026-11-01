import { readPrivateStateJson, writePrivateStateJson } from "./private-state-file.js";

/** ADR-0549: one thing Lervo committed, with the reason its commit records. */
export interface LearnedNoticeEntry {
  kind: "owner_rule" | "skill" | "canonical" | "updated";
  path: string;
  title: string | null;
  /** Repository-relative Markdown link targets the change added; canonical documents only. */
  links: string[];
}

export interface LearnedNotice {
  schemaVersion: 1;
  observedAt: string;
  /** The newest Lervo commit the notice covers; null when none was found. */
  throughCommit: string | null;
  counts: Record<LearnedNoticeEntry["kind"], number>;
  entries: LearnedNoticeEntry[];
}

/** The newest Lervo commit an owner turn has already been shown. */
export interface LearnedNoticeCursor {
  schemaVersion: 1;
  shownThrough: string;
  shownAt: string;
}

const NOTICE = "learned-notice.json";
const CURSOR = "learned-notice-cursor.json";
const COMMIT = /^[a-f0-9]{40,64}$/u;
const KINDS = ["owner_rule", "skill", "canonical", "updated"] as const;

function validNotice(value: unknown): value is LearnedNotice {
  const notice = value as LearnedNotice | null;
  return (
    notice?.schemaVersion === 1 &&
    typeof notice.observedAt === "string" &&
    (notice.throughCommit === null || COMMIT.test(notice.throughCommit)) &&
    KINDS.every((kind) => Number.isInteger(notice.counts?.[kind])) &&
    Array.isArray(notice.entries) &&
    notice.entries.length <= 16 &&
    notice.entries.every(
      (entry) =>
        KINDS.includes(entry?.kind) &&
        typeof entry.path === "string" &&
        (entry.title === null || typeof entry.title === "string") &&
        Array.isArray(entry.links) &&
        entry.links.every((link) => typeof link === "string"),
    )
  );
}

export async function readLearnedNotice(root: string): Promise<LearnedNotice | null> {
  const value = await readPrivateStateJson(root, NOTICE, 64 * 1024);
  return validNotice(value) ? value : null;
}

export async function writeLearnedNotice(root: string, notice: LearnedNotice): Promise<void> {
  await writePrivateStateJson(root, NOTICE, notice);
}

export async function readLearnedNoticeCursor(root: string): Promise<LearnedNoticeCursor | null> {
  const value = (await readPrivateStateJson(root, CURSOR, 4096)) as LearnedNoticeCursor | null;
  return value?.schemaVersion === 1 && COMMIT.test(value.shownThrough ?? "") ? value : null;
}

export async function writeLearnedNoticeCursor(
  root: string,
  shownThrough: string,
  shownAt: string,
): Promise<void> {
  await writePrivateStateJson(root, CURSOR, { schemaVersion: 1, shownThrough, shownAt });
}
