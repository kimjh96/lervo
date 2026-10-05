import { randomUUID } from "node:crypto";
import { chmod, lstat, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

/**
 * Host-local record of knowledge commits the convergence owner superseded (ADR-0468). The
 * repository replica carries it between hosts, so every host drops the same commits.
 */
export const KNOWLEDGE_SUPERSESSION_LEDGER_PATH =
  ".lervo/state/knowledge/knowledge-supersession.json";

/** Bounds the ledger; the oldest supersessions drop out first. */
export const MAXIMUM_KNOWLEDGE_SUPERSESSION_ENTRIES = 64;

/** One superseded `Lervo Knowledge` commit, described by hashes only. */
export interface KnowledgeSupersessionEntry {
  commit: string;
  /** `git patch-id --stable` of the commit, matching copies with another commit id. */
  patchId: string;
  /** The remote base the replay conflicted with; a commit descending from it was regenerated. */
  base: string;
  supersededAt: string;
}

/**
 * Why superseded commits remain on this checkout's branch:
 * - `not_on_branch`: `HEAD` is detached or a Git operation is in progress.
 * - `under_other_work`: a commit that is not superseded knowledge sits above them.
 * - `worktree_conflict`: `reset --keep` refused because uncommitted edits touch their paths.
 */
export type KnowledgeSupersessionHeldReason =
  "not_on_branch" | "under_other_work" | "worktree_conflict";

export interface KnowledgeSupersessionHeld {
  reason: KnowledgeSupersessionHeldReason;
  /** Superseded commits still reachable from `HEAD`. */
  commitCount: number;
  /** When this reason and count were first observed; unchanged observations keep it. */
  observedAt: string;
}

export interface KnowledgeSupersessionLedger {
  schemaVersion: 1;
  entries: KnowledgeSupersessionEntry[];
  held: KnowledgeSupersessionHeld | null;
  /** The latest drop on this checkout; the backup ref keeps the dropped head reachable. */
  lastDrop: { commitCount: number; backupRef: string; droppedAt: string } | null;
}

const OBJECT_ID = /^[0-9a-f]{40,64}$/u;
const HELD_REASONS = new Set(["not_on_branch", "under_other_work", "worktree_conflict"]);
const BACKUP_REF = /^refs\/lervo\/knowledge-superseded\/[0-9a-f]{12}$/u;

const timestamp = (value: unknown): value is string =>
  typeof value === "string" && value.length <= 40 && !Number.isNaN(Date.parse(value));
const count = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

function isEntry(value: unknown): value is KnowledgeSupersessionEntry {
  if (value === null || typeof value !== "object") return false;
  const entry = value as Record<string, unknown>;
  return (
    Object.keys(entry).length === 4 &&
    typeof entry.commit === "string" &&
    OBJECT_ID.test(entry.commit) &&
    typeof entry.patchId === "string" &&
    OBJECT_ID.test(entry.patchId) &&
    typeof entry.base === "string" &&
    OBJECT_ID.test(entry.base) &&
    timestamp(entry.supersededAt)
  );
}

/** Validates entries received from another host; null when any entry is malformed. */
export function parseKnowledgeSupersessionEntries(
  value: unknown,
): KnowledgeSupersessionEntry[] | null {
  return Array.isArray(value) &&
    value.length <= MAXIMUM_KNOWLEDGE_SUPERSESSION_ENTRIES &&
    value.every(isEntry)
    ? value.map((entry) => ({
        commit: entry.commit,
        patchId: entry.patchId,
        base: entry.base,
        supersededAt: entry.supersededAt,
      }))
    : null;
}

function parseHeld(value: unknown): KnowledgeSupersessionHeld | null | undefined {
  if (value === null) return null;
  if (value === undefined || typeof value !== "object") return undefined;
  const held = value as Record<string, unknown>;
  return typeof held.reason === "string" &&
    HELD_REASONS.has(held.reason) &&
    count(held.commitCount) &&
    timestamp(held.observedAt)
    ? (held as unknown as KnowledgeSupersessionHeld)
    : undefined;
}

function parseLastDrop(value: unknown): KnowledgeSupersessionLedger["lastDrop"] | undefined {
  if (value === null) return null;
  if (value === undefined || typeof value !== "object") return undefined;
  const drop = value as Record<string, unknown>;
  return count(drop.commitCount) &&
    typeof drop.backupRef === "string" &&
    BACKUP_REF.test(drop.backupRef) &&
    timestamp(drop.droppedAt)
    ? (drop as unknown as KnowledgeSupersessionLedger["lastDrop"])
    : undefined;
}

/** One checkout's reconciliation, as a replica peer reports it to the coordinator. */
export interface KnowledgeSupersessionReconciliation {
  /** This checkout's ledger after merging the incoming entries. */
  entries: KnowledgeSupersessionEntry[];
  /** Superseded commits this call removed from the tip of the checked-out branch. */
  dropped: { commitCount: number; backupRef: string } | null;
  /** Superseded commits still on the branch, which a replica must not carry to its peer. */
  held: { reason: KnowledgeSupersessionHeldReason; commits: string[] } | null;
}

/** Validates a reconciliation received from another host; null when any field is malformed. */
export function parseKnowledgeSupersessionReconciliation(
  value: unknown,
): KnowledgeSupersessionReconciliation | null {
  if (value === null || typeof value !== "object") return null;
  const report = value as Record<string, unknown>;
  const entries = parseKnowledgeSupersessionEntries(report.entries);
  const dropped = report.dropped as Record<string, unknown> | null | undefined;
  const held = report.held as Record<string, unknown> | null | undefined;
  const droppedValid =
    dropped === null ||
    (typeof dropped === "object" &&
      count(dropped.commitCount) &&
      typeof dropped.backupRef === "string" &&
      BACKUP_REF.test(dropped.backupRef));
  const heldValid =
    held === null ||
    (typeof held === "object" &&
      typeof held.reason === "string" &&
      HELD_REASONS.has(held.reason) &&
      Array.isArray(held.commits) &&
      held.commits.length <= MAXIMUM_KNOWLEDGE_SUPERSESSION_ENTRIES * 2 &&
      held.commits.every((commit) => typeof commit === "string" && OBJECT_ID.test(commit)));
  if (entries === null || !droppedValid || !heldValid) return null;
  return {
    entries,
    dropped:
      dropped === null
        ? null
        : { commitCount: dropped.commitCount as number, backupRef: dropped.backupRef as string },
    held:
      held === null
        ? null
        : {
            reason: held.reason as KnowledgeSupersessionHeldReason,
            commits: [...(held.commits as string[])],
          },
  };
}

export const EMPTY_KNOWLEDGE_SUPERSESSION_LEDGER: KnowledgeSupersessionLedger = {
  schemaVersion: 1,
  entries: [],
  held: null,
  lastDrop: null,
};

/** Missing or invalid state reads as empty; a later supersession or replica cycle refills it. */
export async function readKnowledgeSupersessionLedger(
  root: string,
): Promise<KnowledgeSupersessionLedger> {
  try {
    const path = resolve(root, KNOWLEDGE_SUPERSESSION_LEDGER_PATH);
    const stat = await lstat(path);
    if (!stat.isFile() || stat.size > 65_536) return EMPTY_KNOWLEDGE_SUPERSESSION_LEDGER;
    const value = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown> | null;
    const entries = parseKnowledgeSupersessionEntries(value?.entries);
    const held = parseHeld(value?.held);
    const lastDrop = parseLastDrop(value?.lastDrop);
    return value?.schemaVersion === 1 &&
      entries !== null &&
      held !== undefined &&
      lastDrop !== undefined
      ? { schemaVersion: 1, entries, held, lastDrop }
      : EMPTY_KNOWLEDGE_SUPERSESSION_LEDGER;
  } catch {
    return EMPTY_KNOWLEDGE_SUPERSESSION_LEDGER;
  }
}

export async function writeKnowledgeSupersessionLedger(
  root: string,
  ledger: KnowledgeSupersessionLedger,
): Promise<void> {
  let directory = resolve(root);
  for (const part of [".lervo", "state", "knowledge"]) {
    directory = resolve(directory, part);
    await mkdir(directory, { mode: 0o700 }).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "EEXIST") throw error;
    });
    const stat = await lstat(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink())
      throw new Error("Knowledge supersession ledger directory is invalid.");
  }
  const temporary = resolve(directory, `.knowledge-supersession-${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, `${JSON.stringify(ledger)}\n`, { mode: 0o600, flag: "wx" });
    await chmod(temporary, 0o600);
    await rename(temporary, resolve(root, KNOWLEDGE_SUPERSESSION_LEDGER_PATH));
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

/**
 * Union of two entry sets by commit id, ordered by supersession time and then commit id so
 * every host derives the same ledger from the same inputs, keeping the newest 64.
 */
export function mergeKnowledgeSupersessionEntries(
  current: readonly KnowledgeSupersessionEntry[],
  incoming: readonly KnowledgeSupersessionEntry[],
): KnowledgeSupersessionEntry[] {
  const byCommit = new Map<string, KnowledgeSupersessionEntry>();
  for (const entry of [...current, ...incoming]) {
    const known = byCommit.get(entry.commit);
    if (known === undefined || entry.supersededAt < known.supersededAt)
      byCommit.set(entry.commit, entry);
  }
  return [...byCommit.values()]
    .sort((left, right) =>
      left.supersededAt === right.supersededAt
        ? left.commit.localeCompare(right.commit)
        : left.supersededAt.localeCompare(right.supersededAt),
    )
    .slice(-MAXIMUM_KNOWLEDGE_SUPERSESSION_ENTRIES);
}
