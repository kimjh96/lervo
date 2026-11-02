import { readPrivateStateJson, writePrivateStateJson } from "./private-state-file.js";

/**
 * ADR-0561 notice fields of one effect: what Lervo did, to what, why, who agreed, and the undo.
 * Targets and reviewers are bounded identifiers, never document bodies or secrets.
 */
export interface LearnedEffectNotice {
  effect: string;
  targets: string[];
  reason: string;
  crossCheck: { reviewers: string[]; verdict: string };
  undo: string;
}

/** ADR-0549: one thing Lervo committed or applied, with the reason it records. */
export interface LearnedNoticeEntry {
  kind: "owner_rule" | "skill" | "canonical" | "freshness" | "effect" | "updated";
  path: string;
  title: string | null;
  /** Repository-relative Markdown link targets the change added; canonical documents only. */
  links: string[];
  /** ADR-0561: generated owner rules this owner rule replaced in the same commit. */
  replaced?: string[];
  /** ADR-0561: the owner rule was retired (deleted) rather than stored. */
  retired?: true;
  /** ADR-0561 freshness notice; `effect` is `refresh` or `archive`. */
  freshness?: LearnedEffectNotice;
  /**
   * ADR-0561 effect notice: a cross-checked layout, migration, or structure commit, or an effect
   * from the effect notice journal, such as provider hooks, a capability, or a replica backup.
   */
  effect?: LearnedEffectNotice;
}

export interface LearnedNotice {
  schemaVersion: 1;
  observedAt: string;
  /** The newest Lervo commit the notice covers; null when none was found. */
  throughCommit: string | null;
  counts: Record<LearnedNoticeEntry["kind"], number>;
  entries: LearnedNoticeEntry[];
  /** Older Lervo commits in the range beyond the itemized bound. */
  omittedCommits?: number;
  /** ADR-0561: the newest journal notice the notice covers; absent when it covers none. */
  noticesThrough?: string;
}

/** The newest Lervo commit an owner turn has already been shown. */
export interface LearnedNoticeCursor {
  schemaVersion: 1;
  shownThrough: string;
  shownAt: string;
  /** ADR-0561: the newest journal notice an owner turn was shown. */
  noticesShownThrough?: string;
}

const NOTICE = "learned-notice.json";
const CURSOR = "learned-notice-cursor.json";
const COMMIT = /^[a-f0-9]{40,64}$/u;
const KINDS = ["owner_rule", "skill", "canonical", "freshness", "effect", "updated"] as const;

const strings = (value: unknown): boolean =>
  Array.isArray(value) && value.every((item) => typeof item === "string");

function validEffect(value: LearnedEffectNotice): boolean {
  return (
    [value.effect, value.reason, value.undo, value.crossCheck?.verdict].every(
      (item) => typeof item === "string",
    ) &&
    strings(value.targets) &&
    strings(value.crossCheck.reviewers)
  );
}

function validNotice(value: unknown): value is LearnedNotice {
  const notice = value as LearnedNotice | null;
  return (
    notice?.schemaVersion === 1 &&
    typeof notice.observedAt === "string" &&
    (notice.throughCommit === null || COMMIT.test(notice.throughCommit)) &&
    KINDS.every((kind) => Number.isInteger(notice.counts?.[kind])) &&
    (notice.omittedCommits === undefined || Number.isInteger(notice.omittedCommits)) &&
    (notice.noticesThrough === undefined || Number.isFinite(Date.parse(notice.noticesThrough))) &&
    Array.isArray(notice.entries) &&
    notice.entries.length <= 16 &&
    notice.entries.every(
      (entry) =>
        KINDS.includes(entry?.kind) &&
        typeof entry.path === "string" &&
        (entry.title === null || typeof entry.title === "string") &&
        Array.isArray(entry.links) &&
        entry.links.every((link) => typeof link === "string") &&
        (entry.replaced === undefined ||
          (Array.isArray(entry.replaced) &&
            entry.replaced.every((path) => typeof path === "string"))) &&
        (entry.retired === undefined || entry.retired === true) &&
        (entry.freshness === undefined ||
          ((entry.freshness.effect === "refresh" || entry.freshness.effect === "archive") &&
            validEffect(entry.freshness))) &&
        (entry.effect === undefined || validEffect(entry.effect)),
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
  return value?.schemaVersion === 1 &&
    COMMIT.test(value.shownThrough ?? "") &&
    (value.noticesShownThrough === undefined ||
      Number.isFinite(Date.parse(value.noticesShownThrough)))
    ? value
    : null;
}

export async function writeLearnedNoticeCursor(
  root: string,
  shown: { throughCommit: string; noticesThrough?: string },
  shownAt: string,
): Promise<void> {
  await writePrivateStateJson(root, CURSOR, {
    schemaVersion: 1,
    shownThrough: shown.throughCommit,
    shownAt,
    ...(shown.noticesThrough === undefined ? {} : { noticesShownThrough: shown.noticesThrough }),
  });
}
