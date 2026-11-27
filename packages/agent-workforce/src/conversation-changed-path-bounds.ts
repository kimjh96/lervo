// The bounds of what a conversation generation's changes hold (Lervo ADE coordination,
// "Reconciliation"): which changed paths a claim may name, and how a set past 10,000 entries or
// the state bound coalesces. Pure: the store records the result.
import { MAXIMUM_CONVERSATION_EXPECTED_PATHS } from "./assignment-path-bounds.js";
import { normalizeClaimPath } from "./conversation-claim-input.js";
import { coalesceLeaseEntries, minimalPathCover } from "./conversation-lease-coalescing.js";
import { MAXIMUM_STATE_BYTES } from "./workforce-state-validation.js";

const GLOB = /[*?[\]]/u;
/** Lervo's runtime paths, which no sealed change may contain and no claim names. */
const RUNTIME_PATHS = [".lervo/state", ".lervo/data", ".lervo/run"];
/** Room for a record's other fields below the state bound. */
const PATHS_BYTE_BUDGET = MAXIMUM_STATE_BYTES - 4096;

/** What a generation holds for its changed paths. */
export interface HeldChangedPaths {
  /** A sorted minimal cover within the count and byte bounds. */
  paths: string[];
  /** How many claimable paths changed, before any coalescing. */
  changedPathCount: number;
  coalesced: boolean;
  /** Nothing below the root brought the set within the bounds: top-level entries hold. */
  overflow: boolean;
}

/**
 * The path a claim names for a changed path: the path itself, or for a name with a glob
 * character, the deepest directory before it, as the claim handler names a glob operand. A
 * runtime path, or one the path policy cannot name, holds nothing.
 */
export function claimableChangedPath(path: string): string | null {
  if (RUNTIME_PATHS.some((runtime) => path === runtime || path.startsWith(`${runtime}/`)))
    return null;
  const glob = path.search(GLOB);
  const named = glob === -1 ? path : path.slice(0, Math.max(0, path.lastIndexOf("/", glob)));
  return named === "" ? null : normalizeClaimPath(named);
}

function fits(paths: readonly string[]): boolean {
  return (
    paths.length <= MAXIMUM_CONVERSATION_EXPECTED_PATHS &&
    Buffer.byteLength(JSON.stringify(paths, null, 2)) <= PATHS_BYTE_BUDGET
  );
}

/** The sorted top-level entries of `paths`, as many as the bounds hold. */
function topLevelEntries(paths: readonly string[]): string[] {
  const entries = [...new Set(paths.map((path) => path.split("/")[0]!))].sort();
  const kept: string[] = [];
  let bytes = 2;
  for (const entry of entries) {
    bytes += Buffer.byteLength(JSON.stringify(entry)) + 4;
    if (kept.length === MAXIMUM_CONVERSATION_EXPECTED_PATHS || bytes > PATHS_BYTE_BUDGET) break;
    kept.push(entry);
  }
  return kept;
}

/**
 * The bounded set a generation holds for `changedPaths`: the claimable paths' minimal cover, and
 * past 10,000 entries or the byte bound the deepest directories that bring it within both. When
 * even that cannot fit, the generation holds its top-level entries and overflows. It never holds
 * the whole checkout.
 */
export function heldChangedPaths(changedPaths: readonly string[]): HeldChangedPaths {
  const claimable = minimalPathCover(
    changedPaths.flatMap((path) => claimableChangedPath(path) ?? []),
  );
  const changedPathCount = changedPaths.filter(
    (path) => claimableChangedPath(path) !== null,
  ).length;
  if (fits(claimable))
    return { paths: claimable, changedPathCount, coalesced: false, overflow: false };
  for (
    let limit = Math.min(claimable.length - 1, MAXIMUM_CONVERSATION_EXPECTED_PATHS);
    limit >= 1;
    limit = Math.floor(limit / 2)
  ) {
    const coalesced = coalesceLeaseEntries({
      entries: claimable,
      limit,
      isHeld: () => false,
      responsibilityPaths: ["."],
    });
    if (coalesced === null) break;
    if (fits(coalesced))
      return { paths: coalesced, changedPathCount, coalesced: true, overflow: false };
  }
  return { paths: topLevelEntries(claimable), changedPathCount, coalesced: true, overflow: true };
}
