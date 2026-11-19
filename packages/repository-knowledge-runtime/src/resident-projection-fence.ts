import { lstatSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { canonicalJson, sha256, withProcessCostScope } from "@lervo/repository-knowledge";
import { defaultRepositoryHoldPath } from "@lervo/repository-registry";
import type { OutboxStore } from "@lervo/storage-contract";

import { CONVERGENCE_OWNER_FENCE_PATH } from "./convergence-owner-fence.js";
import { convergenceRepositoryDigest } from "./source-fingerprint.js";

/**
 * ADR-0595: with unchanged inputs the resident refreshes a repository's health projection once
 * this bound passes, under the 20-minute display window of ADR-0535.
 */
export const RESIDENT_PROJECTION_MAXIMUM_AGE_MILLISECONDS = 15 * 60_000;
/** How often the resident checks the projection inputs: one stat pass and one repository digest. */
export const RESIDENT_PROJECTION_CHECK_MILLISECONDS = 60_000;

/** State the health projection reads that can change without a repository content change. */
const PROJECTION_INPUTS = [
  ".lervo/state/node-runtime-health.json",
  ".lervo/state/knowledge/maintenance-observation.json",
  ".lervo/state/knowledge/freshness-cycle.json",
  ".lervo/state/knowledge/document-staleness.json",
  ".lervo/state/knowledge/document-lifecycle.json",
  ".lervo/state/knowledge/convergence-continuity.json",
  ".lervo/state/knowledge/instruction-capture/state.json",
] as const;

function identity(path: string): [string, string] | null {
  try {
    const stat = lstatSync(path, { bigint: true });
    return [stat.size.toString(), stat.mtimeNs.toString()];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

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
    return ["unreadable", identity(path)];
  }
}

/**
 * The digest of what the health projection reads: repository content (the ADR-0461 digest), the
 * event head, the listed state files, the owner role, the host hold store, and the resident's own
 * reported state. Any other read failure throws, so the caller refreshes instead of trusting it.
 */
export function residentProjectionKey(input: {
  repositoryRoot: string;
  events: OutboxStore;
  residentState: string;
}): string {
  const root = input.repositoryRoot;
  return sha256(
    canonicalJson({
      repository: convergenceRepositoryDigest(root),
      eventHead: input.events.latest()?.eventId ?? null,
      inputs: PROJECTION_INPUTS.map((path) => [path, identity(resolve(root, path))]),
      owner: ownerProjection(root),
      repositoryHolds: identity(defaultRepositoryHoldPath()),
      resident: input.residentState,
    }),
  );
}

export interface ResidentProjectionRecord {
  key: string;
  at: number;
  held: boolean;
}

/**
 * A refresh is due when the key is unknown or changed, or after the maximum age while nothing
 * changed. A held repository (ADR-0561) is refreshed once, so the projection shows the hold, and
 * then not again until the hold is released: nothing the resident does there can change it.
 * `ageOnly` (a tick during a running cycle) ignores changes, which the cycle's own offer covers.
 */
export function residentProjectionDue(input: {
  key: string | null;
  last: ResidentProjectionRecord | null;
  now: number;
  held: boolean;
  ageOnly?: boolean;
  maximumAgeMilliseconds: number;
}): boolean {
  if (input.held) return input.last?.held !== true;
  const aged = input.last === null || input.now - input.last.at >= input.maximumAgeMilliseconds;
  if (input.ageOnly === true) return aged;
  return aged || input.key === null || input.key !== input.last?.key;
}

/**
 * The resident's projection offer: it computes the key under its own cost scope, refreshes only
 * when due, and records the key only after a refresh that succeeded, so a failure is retried.
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
  return async (options = {}) => {
    if (!input.enabled || input.signal.aborted) return;
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
    const now = (input.now ?? Date.now)();
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
    // A refresh without a key records an empty one, so the next keyed offer refreshes again.
    if (await input.refresh()) last = { key: key ?? "", at: now, held };
  };
}
