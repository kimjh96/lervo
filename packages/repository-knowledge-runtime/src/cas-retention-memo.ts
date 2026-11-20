import type { EventEnvelope } from "@lervo/schemas";
import { latestEventHash, type OutboxStore } from "@lervo/storage-contract";

import { CasRetentionBoundError } from "./cas-retention-errors.js";
import {
  convergenceArtifactRoots,
  MAXIMUM_RETAINED_CAS_REFERENCES,
  retentionLifecycleEvent,
  type CasRetentionRoots,
} from "./cas-retention-policy.js";
import { casReferences } from "./cas-retention-references.js";
import { RETENTION_IDLE_RECHECK_MILLISECONDS, type RetentionScan } from "./cas-retention-state.js";

/** ADR-0601: roots extended from the last replay are rebuilt by a full replay this often. */
export const RETENTION_ROOTS_FULL_REPLAY_MILLISECONDS = 6 * 60 * 60_000;
const PAGE = 1_000;

type Events = Pick<OutboxStore, "latest" | "latestHash" | "list">;

interface RootsEntry {
  roots: CasRetentionRoots;
  replayedAt: number;
}

interface IdleCursor {
  idleHead: string | null;
  idleAt: number;
  checkedSeq: number;
  checkedHash: string | null;
}

// Keyed by the open store, so a reopened or replaced store always starts from a full replay.
const rootsByStore = new WeakMap<object, RootsEntry>();
const idleByStore = new WeakMap<object, IdleCursor>();

/**
 * The events after `seq` up to the observed head, if they continue the chain from `hash` and fit
 * one page. Null means the caller cannot extend its view and must read from the start.
 */
function eventsSince(
  events: Events,
  seq: number,
  hash: string | null,
): { page: EventEnvelope[]; head: EventEnvelope } | null {
  const head = events.latest();
  if (head === null || head.seq <= seq || head.seq - seq > PAGE) return null;
  const page = events.list({ afterSeq: seq, limit: PAGE });
  let previous = { seq, hash };
  for (const event of page) {
    if (event.seq !== previous.seq + 1 || event.previousHash !== previous.hash) return null;
    previous = { seq: event.seq, hash: event.eventHash };
  }
  const last = page.at(-1);
  return last !== undefined && last.seq === head.seq && last.eventHash === head.eventHash
    ? { page, head }
    : null;
}

/**
 * ADR-0601: the retention roots, replaying the whole log only when it must. Events that take part
 * in no artifact lifecycle only add the references in their payload to the roots, exactly as a
 * replay roots them, so the last replay is extended by those events alone. Any lifecycle event, a
 * gap in the chain, more than a page of new events, a new store, or six hours since the last
 * replay rebuild the roots from the start. Every unlink is still fenced on the exact head.
 */
export function memoizedConvergenceArtifactRoots(
  events: OutboxStore,
  now = Date.now(),
): CasRetentionRoots {
  const cached = rootsByStore.get(events);
  if (
    cached !== undefined &&
    now >= cached.replayedAt &&
    now - cached.replayedAt < RETENTION_ROOTS_FULL_REPLAY_MILLISECONDS
  ) {
    if (latestEventHash(events) === cached.roots.head) return cached.roots;
    const extended = extendRoots(events, cached.roots);
    if (extended !== null) {
      rootsByStore.set(events, { roots: extended, replayedAt: cached.replayedAt });
      return extended;
    }
  }
  const roots = convergenceArtifactRoots(events);
  rootsByStore.set(events, { roots, replayedAt: now });
  return roots;
}

function extendRoots(events: Events, roots: CasRetentionRoots): CasRetentionRoots | null {
  const since = eventsSince(events, roots.headSeq, roots.head);
  if (since === null || since.page.some(retentionLifecycleEvent)) return null;
  const reachable = new Set(roots.reachable);
  const lastReference = new Map(roots.lastReference);
  for (const event of since.page)
    for (const hash of casReferences(JSON.stringify(event.payload))) {
      lastReference.set(hash, event.seq);
      reachable.add(hash);
    }
  if (lastReference.size > MAXIMUM_RETAINED_CAS_REFERENCES)
    throw new CasRetentionBoundError("CAS event reference inventory exceeds its bound.");
  return {
    ...roots,
    head: since.head.eventHash,
    headSeq: since.head.seq,
    reachable,
    lastReference,
  };
}

/**
 * ADR-0597 and ADR-0601: whether the last complete classification still answers "nothing
 * eligible". Eligibility only arises from a lifecycle event or the grace horizon, so events that
 * take part in no lifecycle leave it standing; the recheck interval still covers the horizon.
 * Skipping a pass can only delay collection, never remove a referenced object.
 */
export function retentionStillIdle(scan: RetentionScan, events: Events, now: number): boolean {
  const idle = scan.idle;
  if (idle === undefined || now < idle.at || now - idle.at >= RETENTION_IDLE_RECHECK_MILLISECONDS)
    return false;
  const head = latestEventHash(events);
  if (idle.head === head) return true;
  if (idle.seq === undefined) return false;
  const cursor = idleByStore.get(events);
  const resume =
    cursor !== undefined && cursor.idleHead === idle.head && cursor.idleAt === idle.at
      ? cursor
      : { idleHead: idle.head, idleAt: idle.at, checkedSeq: idle.seq, checkedHash: idle.head };
  if (resume.checkedHash === head) return true;
  const since = eventsSince(events, resume.checkedSeq, resume.checkedHash);
  if (since === null || since.page.some(retentionLifecycleEvent)) return false;
  idleByStore.set(events, {
    ...resume,
    checkedSeq: since.head.seq,
    checkedHash: since.head.eventHash,
  });
  return true;
}
