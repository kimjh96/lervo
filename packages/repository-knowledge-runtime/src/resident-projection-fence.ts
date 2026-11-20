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
/** How often the resident checks the projection inputs: one stat pass, with no Git process. */
export const RESIDENT_PROJECTION_CHECK_MILLISECONDS = 60_000;
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
 * file metadata alone), the event head hash, the listed state files, the owner role, the host
 * hold store, and the resident's own reported state. Working-tree-only edits are left to the
 * maximum age. Any other read failure throws, so the caller refreshes instead of trusting it.
 */
export function residentProjectionKey(input: {
  repositoryRoot: string;
  events: OutboxStore;
  residentState: string;
}): string {
  const root = input.repositoryRoot;
  return sha256(
    canonicalJson({
      repository: repositoryHeadIdentity(root),
      eventHead: latestEventHash(input.events),
      inputs: PROJECTION_INPUTS.map((path) => [path, fileIdentity(resolve(root, path))]),
      owner: ownerProjection(root),
      repositoryHolds: fileIdentity(defaultRepositoryHoldPath()),
      resident: input.residentState,
    }),
  );
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
}

/**
 * A refresh is due when the key is unknown or changed, or after the maximum age while nothing
 * changed. A held repository (ADR-0561) is refreshed when the hold starts and then only at the
 * held maximum age: the resident applies nothing there, so its own changes cannot move the key.
 * `ageOnly` (a tick during a running cycle) ignores changes, which the cycle's own offer covers.
 */
export function residentProjectionDue(input: {
  key: string | null;
  last: ResidentProjectionRecord | null;
  now: number;
  held: boolean;
  ageOnly?: boolean;
  maximumAgeMilliseconds: number;
  heldMaximumAgeMilliseconds?: number;
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
  return aged || input.key === null || input.key !== input.last?.key;
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
}): (options?: { ageOnly?: boolean }) => Promise<void> {
  let last: ResidentProjectionRecord | null = null;
  let failures = 0;
  let retryAt = 0;
  return async (options = {}) => {
    if (!input.enabled || input.signal.aborted) return;
    const now = (input.now ?? Date.now)();
    if (now < retryAt) return;
    const held = input.held();
    const ageOnly = options.ageOnly === true;
    let key: string | null = null;
    if (!held && !ageOnly)
      try {
        key = withProcessCostScope("projection_fence", () =>
          residentProjectionKey({
            repositoryRoot: input.repositoryRoot,
            events: input.events,
            residentState: input.residentState(),
          }),
        );
      } catch {
        key = null;
      }
    if (
      !residentProjectionDue({
        key,
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
    if (refreshed) last = { key: key ?? "", at: now, held };
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
}
