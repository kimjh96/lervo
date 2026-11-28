// ADR-0658: reading reference files until the inventory holds still. A host with several Nodes
// rewrites some `.lervo` state file in nearly every pass, so a pass that gave up on any change
// would never delete anything. Instead it rereads only what changed, a bounded number of rounds.
import { setTimeout as delay } from "node:timers/promises";

import type { ProjectStorage } from "@lervo/project-storage";

import { bindEventWriterBackups } from "./cas-retention-backups.js";
import { REPORT_READ_LIMITS, referenceReadBudget } from "./cas-retention-budget.js";
import {
  casReferenceFiles,
  referenceFile,
  scanReferenceChunk,
  type CasReferenceFile,
  type ReferenceChunkRead,
  type ReferenceScan,
} from "./cas-retention-files.js";
import { noteStall, type CasRetentionObservation } from "./cas-retention-observation.js";
import {
  reachableConvergenceArtifacts,
  retentionReferenceGraph,
  type CasRetentionRoots,
} from "./cas-retention-policy.js";
import {
  releasedConvergenceRecords,
  type ConvergenceRecordShapes,
} from "./cas-retention-record-shapes.js";
import { collectReportReferences } from "./cas-retention-reports.js";
import type { RetentionScan } from "./cas-retention-state.js";

/** Rereads of one file that changed while it was read, within one call (ADR-0658). */
const IMMEDIATE_RESCANS = 3;
/** Rounds of rereading changed files before a pass counts a stall (ADR-0658). */
const INVENTORY_ROUNDS = 5;
const BACKOFF_MS = 50;

/** 50, 100, 200 ms and on: lets a writer, such as SQLite between WAL commits, settle. */
async function backoff(attempt: number): Promise<void> {
  await delay(BACKOFF_MS * 2 ** attempt);
}

/** A fresh scan entry for `file` at its current identity. */
function freshEntry(file: CasReferenceFile): ReferenceScan {
  return {
    identity: file.identity,
    ...(file.mirror === undefined ? {} : { mirror: file.mirror.liveIdentity }),
    complete: false,
    offset: 0,
    tail: "",
    references: [],
  };
}

type Budget = ReturnType<typeof referenceReadBudget>;

/**
 * Reads one reference file's body to completion within the cycle's budget. A live writer that
 * replaced, removed or locked it makes the pass read it again from its new identity, a few times.
 * `restarted` leaves no entry, so the file counts as changed until a later read completes.
 */
export async function scanReferenceFile(
  file: CasReferenceFile,
  scan: RetentionScan,
  eligible: ReadonlySet<string>,
  budget: Budget,
  observation: CasRetentionObservation,
): Promise<"complete" | "exhausted" | "restarted"> {
  let rescans = 0;
  const cached = scan.files[file.key];
  let entry: ReferenceScan =
    cached !== undefined &&
    cached.identity === file.identity &&
    cached.mirror === file.mirror?.liveIdentity
      ? cached
      : freshEntry(file);
  while (!entry.complete) {
    const sqlite = file.hash === null && /\.(?:sqlite|db)$/u.test(file.path);
    if (await budget.exhausted(sqlite ? 1024 * 1024 : 1)) return "exhausted";
    const prior: ReferenceScan = entry;
    const read: ReferenceChunkRead | null = await budget.read(
      (): Promise<ReferenceChunkRead | null> =>
        scanReferenceChunk(file, prior, eligible, budget.remainingBytes()),
      (result: ReferenceChunkRead | null): number => result?.bytesRead ?? 0,
    );
    if (read !== null) {
      entry = read.scan;
      scan.files[file.key] = entry;
      continue;
    }
    if (rescans < IMMEDIATE_RESCANS) await backoff(rescans);
    const current =
      rescans < IMMEDIATE_RESCANS
        ? await referenceFile(file.path, file.hash).catch(() => null)
        : null;
    if (current !== null) {
      rescans++;
      file.identity = current.identity;
      file.size = current.size;
      file.modifiedAt = current.modifiedAt;
      entry = freshEntry(file);
      continue;
    }
    delete scan.files[file.key];
    if (rescans >= IMMEDIATE_RESCANS) {
      observation.failure = "unstable_reference";
      observation.reference = file.path;
    }
    return "restarted";
  }
  return "complete";
}

/** A file whose complete entry was read at exactly the identity the inventory lists. */
function settledFile(scan: RetentionScan, file: CasReferenceFile): boolean {
  const entry = scan.files[file.key];
  return entry !== undefined && entry.complete && entry.identity === file.identity;
}

export interface SettledInventory {
  files: CasReferenceFile[];
  marked: Set<string>;
  released: ReturnType<typeof releasedConvergenceRecords>;
}

/**
 * Builds the reference graph from the scanned files, then lists the inventory again. If any file
 * changed, appeared, vanished or was left unread, it rereads only those files and tries again, up
 * to `INVENTORY_ROUNDS` times. Unchanged files' references are already known, and each changed
 * file is read after its change, so a round whose listing matches every complete entry yields the
 * same guarantee as one unchanged pass: the last read of every file follows its last change.
 * Returns null when the pass must stop for this cycle; a stall is counted only if the inventory
 * never held still.
 */
export async function settleReferenceInventory(input: {
  storage: ProjectStorage;
  scan: RetentionScan;
  files: CasReferenceFile[];
  roots: CasRetentionRoots;
  eligible: ReadonlySet<string>;
  records: ConvergenceRecordShapes;
  before: number;
  budget: Budget;
  observation: CasRetentionObservation;
  shouldYield: () => Promise<boolean>;
}): Promise<SettledInventory | null> {
  const { storage, scan, roots, eligible, observation } = input;
  let files = input.files;
  for (let round = 0; ; round++) {
    let current: CasReferenceFile[];
    if (files.every((file) => settledFile(scan, file))) {
      const released = releasedConvergenceRecords(
        files,
        roots.superseded,
        input.records,
        input.before,
      );
      const { reachable, edges } = retentionReferenceGraph(
        files,
        (file) => scan.files[file.key]!.references,
        roots,
        eligible,
        released,
      );
      if (
        !(await collectReportReferences({
          storage,
          roots,
          reachable,
          scan,
          casHashes: new Set(files.flatMap((file) => (file.hash === null ? [] : [file.hash]))),
          budget: referenceReadBudget(REPORT_READ_LIMITS, input.shouldYield),
        }))
      )
        return null;
      const marked = reachableConvergenceArtifacts(reachable, edges);
      current = await casReferenceFiles(storage);
      if (
        JSON.stringify(files.map((file) => [file.key, file.identity])) ===
        JSON.stringify(current.map((file) => [file.key, file.identity]))
      ) {
        // Every file was read after its last change, so an earlier instability is resolved.
        if (observation.failure === "unstable_reference") {
          observation.failure = null;
          delete observation.reference;
        }
        return { files, marked, released };
      }
    } else current = await casReferenceFiles(storage);
    if (round >= INVENTORY_ROUNDS) {
      noteStall(observation, "inventory_changed");
      return null;
    }
    await backoff(round);
    const next = await rereadChanged(input, files, current);
    if (next === null) return null;
    files = next;
  }
}

/**
 * Keeps unchanged files and their mirror bindings, drops vanished ones, and reads every changed or
 * new file again. Returns null when the cycle's budget ran out.
 */
async function rereadChanged(
  input: Parameters<typeof settleReferenceInventory>[0],
  files: CasReferenceFile[],
  current: CasReferenceFile[],
): Promise<CasReferenceFile[] | null> {
  const { storage, scan, roots, eligible, budget, observation } = input;
  const known = new Map(files.map((file) => [file.key, file]));
  const changed = current.filter(
    (file) => known.get(file.key)?.identity !== file.identity || !settledFile(scan, file),
  );
  await bindEventWriterBackups(storage, roots.headSeq, changed);
  const keys = new Set(current.map((file) => file.key));
  for (const key of Object.keys(scan.files)) if (!keys.has(key)) delete scan.files[key];
  const reread = new Set(changed);
  for (const file of changed)
    if ((await scanReferenceFile(file, scan, eligible, budget, observation)) === "exhausted")
      return null;
  return current.map((file) => (reread.has(file) ? file : known.get(file.key)!));
}
