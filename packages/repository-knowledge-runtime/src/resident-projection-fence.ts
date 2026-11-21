import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { canonicalJson, sha256, withProcessCostScope } from "@lervo/repository-knowledge";
import { defaultRepositoryHoldPath } from "@lervo/repository-registry";
import { latestEventHash, type OutboxStore } from "@lervo/storage-contract";

import { CONVERGENCE_OWNER_FENCE_PATH } from "./convergence-owner-fence.js";
import { fileIdentity, repositoryHeadIdentity } from "./repository-head-identity.js";

/**
 * ADR-0595: with unchanged inputs the resident refreshes a repository's health projection once
 * this bound passes, under the 20-minute display window of ADR-0535.
 */
export const RESIDENT_PROJECTION_MAXIMUM_AGE_MILLISECONDS = 15 * 60_000;
/**
 * A held repository (ADR-0561) refreshes once when the hold starts and then at this age, so its
 * Node, replica and attention lines stay bounded while the resident itself applies nothing.
 */
export const RESIDENT_HELD_PROJECTION_MAXIMUM_AGE_MILLISECONDS = 60 * 60_000;
/** The first retry after a failed refresh; later retries double (ADR-0597). */
export const RESIDENT_PROJECTION_CHECK_MILLISECONDS = 60_000;
/**
 * ADR-0599: an event-head change alone refreshes the projection at most this often. Every turn
 * of an active terminal session appends events, and health shows them only as counts and stop
 * times inside the 20-minute display window.
 */
export const RESIDENT_PROJECTION_EVENT_INTERVAL_MILLISECONDS = 5 * 60_000;
/** ADR-0597: a failed refresh is retried after 1, 2, 4 and 8 minutes, then every 15 minutes. */
export const RESIDENT_PROJECTION_RETRY_CEILING_MILLISECONDS = 15 * 60_000;

/**
 * State the health projection reads that can change without a repository content change. The
 * projection also reads cached operating attention sources, the terminal lifecycle cache, the
 * appearance, Find replay and turn governance summaries, and the publication state; those rely
 * on the maximum age, because the prefetch rewrites some of them itself.
 */
const PROJECTION_INPUTS = [
  ".lervo/state/node-runtime-health.json",
  ".lervo/state/knowledge/maintenance-observation.json",
  ".lervo/state/knowledge/freshness-cycle.json",
  ".lervo/state/knowledge/document-staleness.json",
  ".lervo/state/knowledge/document-lifecycle.json",
  ".lervo/state/knowledge/convergence-continuity.json",
  ".lervo/state/knowledge/instruction-capture/state.json",
] as const;

/**
 * The owner fence is rewritten at every ownership observation, so only the fields the projection
 * shows (role and holder) enter the key; an unreadable fence keys as its file identity.
 */
function ownerProjection(root: string): unknown {
  const path = resolve(root, CONVERGENCE_OWNER_FENCE_PATH);
  try {
    const verdict = (
      JSON.parse(readFileSync(path, "utf8")) as {
        verdict?: { role?: unknown; holder?: { label?: unknown; hostHash?: unknown } | null };
      }
    ).verdict;
    return [
      verdict?.role ?? null,
      verdict?.holder?.label ?? null,
      verdict?.holder?.hostHash ?? null,
    ];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    return ["unreadable", fileIdentity(path)];
  }
}

/**
 * The digest of what the health projection reads: the repository head and index (ADR-0597, from
 * file metadata alone), the listed state files, the owner role, the host hold store, and the
 * resident's own reported state. ADR-0599 keeps the event head out of it (see
 * `residentProjectionEventHead`). Working-tree-only edits are left to the maximum age. Any other
 * read failure throws, so the caller refreshes instead of trusting it.
 */
export function residentProjectionKey(input: {
  repositoryRoot: string;
  residentState: string;
}): string {
  const root = input.repositoryRoot;
  return sha256(
    canonicalJson({
      repository: repositoryHeadIdentity(root),
      inputs: PROJECTION_INPUTS.map((path) => [path, fileIdentity(resolve(root, path))]),
      owner: ownerProjection(root),
      repositoryHolds: fileIdentity(defaultRepositoryHoldPath()),
      resident: input.residentState,
    }),
  );
}

/**
 * ADR-0602: the files whose change makes a refresh due, watched so that a change offers a refresh
 * at once instead of on a minute check. The repository head and index enter through the
 * repository watch; working-tree edits and the unwatched caches rely on the maximum age.
 */
export function residentProjectionInputPaths(repositoryRoot: string): string[] {
  return [
    ...PROJECTION_INPUTS.map((path) => resolve(repositoryRoot, path)),
    resolve(repositoryRoot, CONVERGENCE_OWNER_FENCE_PATH),
    defaultRepositoryHoldPath(),
  ];
}

/** ADR-0599: the event head the projection last showed; its change alone is rate-limited. */
export function residentProjectionEventHead(events: OutboxStore): string | null {
  return latestEventHash(events);
}

/** The wait after `failures` consecutive failed refreshes (ADR-0597). */
export function residentProjectionRetryDelay(failures: number): number {
  if (failures <= 0) return 0;
  return Math.min(
    RESIDENT_PROJECTION_CHECK_MILLISECONDS * 2 ** Math.min(failures - 1, 16),
    RESIDENT_PROJECTION_RETRY_CEILING_MILLISECONDS,
  );
}

export interface ResidentProjectionRecord {
  key: string;
  at: number;
  held: boolean;
  /** ADR-0599: the event head at that refresh; undefined compares as unchanged. */
  eventHead?: string | null;
}

/**
 * A refresh is due when the key is unknown or changed, or after the maximum age while nothing
 * changed. ADR-0599: a changed event head alone is due once the event interval has passed since
 * the last refresh. A held repository (ADR-0561) is refreshed when the hold starts and then only
 * at the held maximum age: the resident applies nothing there, so its own changes cannot move the
 * key. `ageOnly` (a tick during a running cycle) ignores changes, which the cycle's own offer
 * covers.
 */
export function residentProjectionDue(input: {
  key: string | null;
  eventHead?: string | null;
  last: ResidentProjectionRecord | null;
  now: number;
  held: boolean;
  ageOnly?: boolean;
  maximumAgeMilliseconds: number;
  heldMaximumAgeMilliseconds?: number;
  eventIntervalMilliseconds?: number;
}): boolean {
  if (input.held)
    return (
      input.last === null ||
      !input.last.held ||
      input.now - input.last.at >=
        (input.heldMaximumAgeMilliseconds ?? RESIDENT_HELD_PROJECTION_MAXIMUM_AGE_MILLISECONDS)
    );
  const aged = input.last === null || input.now - input.last.at >= input.maximumAgeMilliseconds;
  if (input.ageOnly === true) return aged;
  if (aged || input.key === null || input.key !== input.last?.key) return true;
  const eventMoved =
    input.eventHead !== undefined &&
    input.last.eventHead !== undefined &&
    input.eventHead !== input.last.eventHead;
  return (
    eventMoved &&
    input.now - input.last.at >=
      (input.eventIntervalMilliseconds ?? RESIDENT_PROJECTION_EVENT_INTERVAL_MILLISECONDS)
  );
}

/**
 * The resident's projection offer: it computes the key under its own cost scope, refreshes only
 * when due, and records the key only after a refresh that succeeded. A failed refresh or an
 * uncomputable key is retried after a growing wait (ADR-0597), so neither refreshes every minute.
 */
export function residentProjectionRefresher(input: {
  repositoryRoot: string;
  events: OutboxStore;
  enabled: boolean;
  signal: AbortSignal;
  refresh: () => Promise<boolean>;
  residentState: () => string;
  held: () => boolean;
  maximumAgeMilliseconds: number;
  now?: () => number;
}): ResidentProjectionRefresh {
  let last: ResidentProjectionRecord | null = null;
  // Before the first refresh the age bound counts from the start, as a first check would.
  const startedAt = (input.now ?? Date.now)();
  let failures = 0;
  let retryAt = 0;
  // The newest event head an offer saw; a refresh it did not run yet is due at the event interval.
  let seenEventHead: string | null | undefined;
  const offer = async (options: { ageOnly?: boolean } = {}) => {
    if (!input.enabled || input.signal.aborted) return;
    const now = (input.now ?? Date.now)();
    if (now < retryAt) return;
    // ADR-0602: a retry that fell due refreshes, so its deadline never comes back in the past.
    const retryDue = retryAt > 0;
    const held = input.held();
    const ageOnly = options.ageOnly === true;
    let key: string | null = null;
    let eventHead: string | null | undefined;
    if (!held && !ageOnly)
      try {
        ({ key, eventHead } = withProcessCostScope("projection_fence", () => ({
          key: residentProjectionKey({
            repositoryRoot: input.repositoryRoot,
            residentState: input.residentState(),
          }),
          eventHead: residentProjectionEventHead(input.events),
        })));
        seenEventHead = eventHead;
      } catch {
        key = null;
      }
    if (
      !retryDue &&
      !residentProjectionDue({
        key,
        ...(eventHead === undefined ? {} : { eventHead }),
        last,
        now,
        held,
        ageOnly,
        maximumAgeMilliseconds: input.maximumAgeMilliseconds,
      })
    )
      return;
    const refreshed = await input.refresh();
    // A refresh without a key records an empty one, so the next keyed offer refreshes again.
    if (refreshed)
      last = { key: key ?? "", at: now, held, ...(eventHead === undefined ? {} : { eventHead }) };
    // ADR-0597: an uncomputable key backs off like a failed refresh, so a repository whose key
    // stays unreadable is refreshed at a growing interval instead of every minute.
    if (refreshed && (key !== null || held || ageOnly)) {
      failures = 0;
      retryAt = 0;
      return;
    }
    failures = Math.min(failures + 1, 64);
    retryAt = now + residentProjectionRetryDelay(failures);
  };
  return Object.assign(offer, {
    nextDueAt: (options: { ageOnly?: boolean } = {}): number | null => {
      if (!input.enabled) return null;
      if (retryAt > 0) return retryAt;
      if (last === null) return startedAt + input.maximumAgeMilliseconds;
      const held = input.held();
      if (held)
        return last.held ? last.at + RESIDENT_HELD_PROJECTION_MAXIMUM_AGE_MILLISECONDS : last.at;
      const aged = last.at + input.maximumAgeMilliseconds;
      // An age-only offer (during a cycle) ignores a moved head, so only the age bound is due.
      if (options.ageOnly === true) return aged;
      const eventMoved =
        seenEventHead !== undefined &&
        last.eventHead !== undefined &&
        seenEventHead !== last.eventHead;
      return eventMoved
        ? Math.min(aged, last.at + RESIDENT_PROJECTION_EVENT_INTERVAL_MILLISECONDS)
        : aged;
    },
  });
}

/**
 * Offers a refresh; `nextDueAt` is the earliest moment an offer could refresh with no further
 * change (ADR-0602), or null when the next offer depends on a change or the next cycle.
 */
export type ResidentProjectionRefresh = ((options?: { ageOnly?: boolean }) => Promise<void>) & {
  /** With `ageOnly`, the moment the next age-only offer could refresh. */
  nextDueAt(options?: { ageOnly?: boolean }): number | null;
};
