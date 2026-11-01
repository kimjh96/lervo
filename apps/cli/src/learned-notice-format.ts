import type { LearnedNotice, LearnedNoticeEntry } from "./learned-notice-state.js";

const MAXIMUM_LINE_BYTES = 480;

function singleLine(value: string): string {
  return value.replace(/[\r\n\u0000-\u001f\u007f]/gu, " ");
}

function describe(entry: LearnedNoticeEntry): string {
  const name = entry.title === null ? entry.path : `"${entry.title}" (${entry.path})`;
  if (entry.kind === "owner_rule") return `owner rule ${name}`;
  if (entry.kind === "skill") return `skill ${entry.title ?? entry.path}`;
  if (entry.kind === "canonical")
    return `canon ${name} from development${entry.links.length ? `, links ${entry.links.join(", ")}` : ""}`;
  return `updated ${entry.path}`;
}

/**
 * ADR-0549: one information line, never a task. Owner rules, skills, and canon come before
 * background updates; whole items survive the byte cap and the rest are counted.
 */
export function formatLearnedNotice(notice: LearnedNotice): string | null {
  const total = Object.values(notice.counts).reduce((sum, count) => sum + count, 0);
  if (total === 0) return null;
  const order: LearnedNoticeEntry["kind"][] = ["owner_rule", "skill", "canonical", "updated"];
  const entries = [...notice.entries].sort(
    (left, right) => order.indexOf(left.kind) - order.indexOf(right.kind),
  );
  const head = "Lervo learned since it last reported (information, no action needed): ";
  const tail = "; details: git log --author=knowledge@lervo.invalid.";
  const parts: string[] = [];
  for (const entry of entries) {
    const next = singleLine(describe(entry));
    const remaining = total - parts.length - 1;
    const omitted = remaining > 0 ? `; ${remaining} more` : "";
    if (Buffer.byteLength(head + [...parts, next].join("; ") + omitted + tail) > MAXIMUM_LINE_BYTES)
      break;
    parts.push(next);
  }
  const omitted = total - parts.length;
  return `${head}${parts.join("; ")}${omitted > 0 ? `${parts.length ? "; " : ""}${omitted} more` : ""}${tail}`;
}
