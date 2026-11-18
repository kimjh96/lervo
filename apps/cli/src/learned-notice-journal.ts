import type { LervoEffectNoticeV1 } from "@lervo/project";

import type { LearnedNotice, LearnedNoticeEntry } from "./learned-notice-state.js";

const MAXIMUM_ENTRIES = 16;
const MAXIMUM_TARGETS = 8;
const FIRST_RUN_WINDOW_MS = 86_400_000;

function journalEntry(notice: LervoEffectNoticeV1): LearnedNoticeEntry {
  return {
    kind: "effect",
    path: `${notice.effect}@${notice.occurredAt}`,
    title: null,
    links: [],
    effect: {
      effect: notice.effect,
      targets: notice.targets.slice(0, MAXIMUM_TARGETS),
      reason: notice.reason,
      crossCheck: notice.crossCheck,
      undo: notice.undo,
    },
  };
}

/**
 * ADR-0561: effects without a commit of their own (provider hooks, capabilities, state, workstream
 * heads, replica backups) are reported from the effect notice journal, newest first, beside the
 * commits. Journal notices newer than the last shown one are new; a first run looks back 24 hours.
 */
export function withJournalNotices(
  notice: LearnedNotice,
  journal: readonly LervoEffectNoticeV1[],
  noticesShownThrough: string | null,
  now: Date,
): LearnedNotice {
  const after =
    noticesShownThrough === null
      ? now.getTime() - FIRST_RUN_WINDOW_MS
      : Date.parse(noticesShownThrough);
  const fresh = journal
    .filter((item) => Date.parse(item.occurredAt) > after)
    .sort((left, right) => Date.parse(right.occurredAt) - Date.parse(left.occurredAt));
  if (fresh.length === 0) return notice;
  const room = Math.max(0, MAXIMUM_ENTRIES - notice.entries.length);
  return {
    ...notice,
    counts: { ...notice.counts, effect: notice.counts.effect + fresh.length },
    entries: [...notice.entries, ...fresh.slice(0, room).map(journalEntry)],
    noticesThrough: fresh[0]!.occurredAt,
  };
}
