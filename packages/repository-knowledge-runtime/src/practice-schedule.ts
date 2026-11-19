import { lstatSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { canonicalJson, sha256 } from "@lervo/repository-knowledge";

import { PRACTICE_ROOT } from "./practice-store.js";
import type { PracticeState } from "./practice-state.js";

const MINUTE = 60_000;
const DAY = 86_400_000;
/** The practice stage assesses a work record after 30 minutes without another owner turn. */
const WORK_QUIET_MILLISECONDS = 30 * MINUTE;
/** Compaction expires an unresolved candidate after 7 days. */
const CANDIDATE_EXPIRY_MILLISECONDS = 7 * DAY;
const ACTIVE = new Set(["assessed", "unresolved", "drafted", "reviewed_accepted"]);
const MAXIMUM_BYTES = 16 * 1024 * 1024;

export interface PracticeSchedule {
  /** Digest of the time-based practice items already due; it changes once per newly due item. */
  dueDigest: string;
  /** The earliest future moment a scheduled practice item falls due, or null. */
  nextDueAt: number | null;
}

function at(value: string | null | undefined): number {
  const parsed = value == null ? Number.NaN : Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error("Invalid practice timestamp.");
  return parsed;
}

/** A moment the practice stage would act, keyed so a new moment is new. */
interface PracticeMoment {
  key: string;
  at: number;
  /**
   * Whether the resident sets its timer for it. A resume time after an admission wait is not:
   * those repeat every minute while the owner works, and the backoff picks them up instead.
   */
  wake: boolean;
}

function practiceMoments(state: PracticeState, now: number): PracticeMoment[] {
  const moments: PracticeMoment[] = [];
  const resumed = (key: string, value: string | null | undefined) => {
    if (value != null) moments.push({ key, at: at(value), wake: false });
  };
  const assessed = new Set(state.assessed.map((item) => item.workDigest));
  for (const work of state.works) {
    if (assessed.has(work.workDigest)) continue;
    const key = `work:${work.workDigest}`;
    moments.push({ key, at: at(work.observedAt) + WORK_QUIET_MILLISECONDS, wake: true });
    resumed(`${key}:resume`, work.resumeAt);
  }
  for (const candidate of state.candidates) {
    if (!ACTIVE.has(candidate.state)) continue;
    const key = `candidate:${candidate.candidateId}`;
    moments.push({ key, at: at(candidate.observedAt), wake: true });
    resumed(`${key}:resume`, candidate.resumeAt);
    if (candidate.commit === null)
      moments.push({
        key: `expiry:${candidate.candidateId}`,
        at: at(candidate.observedAt) + CANDIDATE_EXPIRY_MILLISECONDS,
        wake: true,
      });
  }
  for (const skill of state.generated) resumed(`skill:${skill.candidateId}:resume`, skill.resumeAt);
  // Usage of generated skills is assessed once per UTC day.
  if (state.generated.length > 0) {
    const today = Math.floor(now / DAY) * DAY;
    moments.push(
      { key: `usage:${today}`, at: today, wake: true },
      { key: `usage:${today + DAY}`, at: today + DAY, wake: true },
    );
  }
  return moments;
}

/** One parsed state per repository root; the knowledge host runs one resident per repository. */
const cached = new Map<string, { identity: string; state: PracticeState }>();

/**
 * ADR-0595: the practice part of the change fence. Instead of a 30-minute clock window that forced
 * a full cycle on every repository, the fence carries which practice items are already due and
 * the moment the next scheduled one falls due, so the resident wakes exactly then; a passed resume
 * time changes the fence for the next observation without setting the timer. The state file is parsed
 * again only when its metadata changes. Any read or parse failure throws; the caller then keeps
 * the clock window, so practice is never delayed by an unreadable schedule.
 */
export function observePracticeSchedule(root: string, now: number): PracticeSchedule {
  const path = resolve(root, PRACTICE_ROOT, "state.json");
  let state: PracticeState | null = null;
  try {
    const stat = lstatSync(path, { bigint: true });
    if (!stat.isFile() || stat.size > BigInt(MAXIMUM_BYTES))
      throw new Error("Invalid practice state.");
    const identity = [stat.size, stat.mtimeNs, stat.ctimeNs, stat.ino].join(":");
    let entry = cached.get(path);
    if (entry?.identity !== identity) {
      const value = JSON.parse(readFileSync(path, "utf8")) as PracticeState;
      if (
        value?.schemaVersion !== 1 ||
        ![value.works, value.candidates, value.generated, value.assessed].every(Array.isArray)
      )
        throw new Error("Invalid practice state.");
      entry = { identity, state: value };
      cached.set(path, entry);
    }
    state = entry.state;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const moments = state === null ? [] : practiceMoments(state, now);
  const due = moments
    .filter((moment) => moment.at <= now)
    .map((moment) => `${moment.key}@${moment.at}`)
    .sort();
  const future = moments
    .filter((moment) => moment.wake && moment.at > now)
    .map((moment) => moment.at);
  return {
    dueDigest: sha256(canonicalJson(due)),
    nextDueAt: future.length === 0 ? null : Math.min(...future),
  };
}

/** The next UTC day boundary, when the daily terminal skill usage window rolls over. */
export function nextUtcDayAt(now: number): number {
  return (Math.floor(now / DAY) + 1) * DAY;
}
