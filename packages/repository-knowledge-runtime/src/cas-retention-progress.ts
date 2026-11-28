// ADR-0660: whether a slice that ran out of read budget still advanced. Without this, a large file
// that changes between slices would be read from its start every slice, forever, unnoticed.
import type { ReferenceScan } from "./cas-retention-files.js";
import type { RetentionScan } from "./cas-retention-state.js";

export interface ScanProgressMark {
  entries: Map<string, { identity: string; position: number }>;
  records: number;
  reports: number;
}

/** How far a body or SQLite read got; a complete entry is past every position. */
function position(entry: ReferenceScan): number {
  if (entry.complete) return Number.POSITIVE_INFINITY;
  return entry.sqlite === undefined
    ? entry.offset
    : entry.sqlite.table * 2 ** 32 + entry.sqlite.row;
}

export function scanProgressMark(scan: RetentionScan): ScanProgressMark {
  return {
    entries: new Map(
      Object.entries(scan.files).map(([key, entry]) => [
        key,
        { identity: entry.identity, position: position(entry) },
      ]),
    ),
    records: Object.keys(scan.records ?? {}).length,
    reports: Object.keys(scan.reports).length,
  };
}

/**
 * True when the slice classified a record, cached a report, or read further into a file at the
 * identity it had before. A file whose identity changed restarted, which is no progress.
 */
export function scanAdvanced(before: ScanProgressMark, scan: RetentionScan): boolean {
  if (Object.keys(scan.records ?? {}).length > before.records) return true;
  if (Object.keys(scan.reports).length > before.reports) return true;
  for (const [key, entry] of Object.entries(scan.files)) {
    const prior = before.entries.get(key);
    const now = position(entry);
    if (prior === undefined ? now > 0 : prior.identity === entry.identity && now > prior.position)
      return true;
  }
  return false;
}
