import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { resolveProjectPaths } from "./layout.js";

/**
 * ADR-0561 step three: the after-the-fact notice of one consequential effect Lervo applied without
 * a commit of its own, such as a provider hook backup, a capability install, a workstream head
 * reconciliation, or a replica backup branch. It is information, never a task, and carries
 * bounded identifiers only: no document bodies, prompts, provider output, or secrets. The ADR-0549
 * learned notice reports it beside Lervo's commits.
 */
export interface LervoEffectNoticeV1 {
  schemaVersion: 1;
  /** Stable for one effect, so recording it again does not report it twice. */
  noticeId: string;
  occurredAt: string;
  /** A closed snake_case effect name, such as `terminal_integration` or `replica_backup`. */
  effect: string;
  /** Repository-relative paths, plan IDs, branches, or content hashes; at most 16. */
  targets: string[];
  reason: string;
  crossCheck: {
    /** Who agreed: independent reviewer sessions or the post-apply verification, never a person. */
    reviewers: string[];
    verdict: string;
  };
  /** The one command that undoes the effect. */
  undo: string;
}

interface EffectNoticeJournal {
  schemaVersion: 1;
  notices: LervoEffectNoticeV1[];
}

/** The newest notices kept; older ones were already reported or are no longer worth reporting. */
const MAXIMUM_NOTICES = 64;
const MAXIMUM_TARGETS = 16;
const EFFECT = /^[a-z][a-z0-9_]{0,63}$/u;

function journalPath(repositoryRoot: string): string {
  return resolve(resolveProjectPaths(repositoryRoot).data, "effect-notices.json");
}

function line(value: string, limit: number): string {
  return value.replace(/[\r\n\u0000-\u001f\u007f]+/gu, " ").slice(0, limit);
}

function validNotice(value: unknown): value is LervoEffectNoticeV1 {
  const notice = value as LervoEffectNoticeV1 | null;
  return (
    notice?.schemaVersion === 1 &&
    typeof notice.noticeId === "string" &&
    Number.isFinite(Date.parse(notice.occurredAt)) &&
    EFFECT.test(notice.effect) &&
    Array.isArray(notice.targets) &&
    notice.targets.every((target) => typeof target === "string") &&
    typeof notice.reason === "string" &&
    Array.isArray(notice.crossCheck?.reviewers) &&
    notice.crossCheck.reviewers.every((reviewer) => typeof reviewer === "string") &&
    typeof notice.crossCheck.verdict === "string" &&
    typeof notice.undo === "string"
  );
}

/** Every recorded notice, oldest first; an absent or unreadable journal holds none. */
export async function readEffectNotices(repositoryRoot: string): Promise<LervoEffectNoticeV1[]> {
  try {
    const value = JSON.parse(
      await readFile(journalPath(repositoryRoot), "utf8"),
    ) as EffectNoticeJournal;
    return value.schemaVersion === 1 && Array.isArray(value.notices)
      ? value.notices.filter(validNotice)
      : [];
  } catch {
    return [];
  }
}

/**
 * Records one notice, bounded and single-line. A notice with an already recorded `noticeId` is
 * ignored. The write is atomic; a concurrent writer may lose one notice, never corrupt the file.
 */
export async function recordEffectNotice(
  repositoryRoot: string,
  notice: Omit<LervoEffectNoticeV1, "schemaVersion">,
): Promise<void> {
  if (!EFFECT.test(notice.effect)) throw new Error("An effect notice needs a snake_case effect.");
  const bounded: LervoEffectNoticeV1 = {
    schemaVersion: 1,
    noticeId: line(notice.noticeId, 128),
    occurredAt: new Date(notice.occurredAt).toISOString(),
    effect: notice.effect,
    targets: notice.targets.slice(0, MAXIMUM_TARGETS).map((target) => line(target, 200)),
    reason: line(notice.reason, 400),
    crossCheck: {
      reviewers: notice.crossCheck.reviewers.slice(0, 4).map((reviewer) => line(reviewer, 120)),
      verdict: line(notice.crossCheck.verdict, 40),
    },
    undo: line(notice.undo, 300),
  };
  const notices = await readEffectNotices(repositoryRoot);
  if (notices.some((item) => item.noticeId === bounded.noticeId)) return;
  const path = journalPath(repositoryRoot);
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const next = `${path}.${process.pid}.${randomBytes(4).toString("hex")}.next`;
  const journal: EffectNoticeJournal = {
    schemaVersion: 1,
    notices: [...notices, bounded].slice(-MAXIMUM_NOTICES),
  };
  try {
    await writeFile(next, `${JSON.stringify(journal, null, 2)}\n`, { mode: 0o600 });
    await rename(next, path);
  } finally {
    await rm(next, { force: true });
  }
}
