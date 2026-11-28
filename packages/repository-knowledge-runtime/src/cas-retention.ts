import { readRetentionScan, saveScan, type RetentionScan } from "./cas-retention-state.js";
import { memoizedConvergenceArtifactRoots, retentionStillIdle } from "./cas-retention-memo.js";
import { resolve } from "node:path";

import type { ProjectStorage } from "@lervo/project-storage";
import { withRepositoryKnowledgeWorkerLock } from "@lervo/repository-knowledge-compiler";
import { materializationTransactionState } from "./materialization-transaction.js";
import { scanAdvanced, scanProgressMark, type ScanProgressMark } from "./cas-retention-progress.js";
import {
  classifyRetentionFailure,
  noteProgress,
  noteReadProgress,
  noteRemaining,
  noteStall,
  noteSweep,
  startObservation,
  writeObservation,
  type CasRetentionObservation,
} from "./cas-retention-observation.js";
import { expireTombstones } from "./cas-retention-tombstones.js";
import {
  CAS_RETENTION_SLICE_MS,
  REFERENCE_SCAN_LIMITS,
  referenceReadBudget,
} from "./cas-retention-budget.js";
import {
  CONVERGENCE_ARTIFACT_GRACE_MS,
  eligibleConvergenceArtifacts,
} from "./cas-retention-policy.js";
import { sweepUnreachableObjects } from "./cas-retention-sweep.js";
import { classifyConvergenceRecords } from "./cas-retention-records.js";
import {
  releasedConvergenceRecords,
  type ConvergenceRecordShapes,
} from "./cas-retention-record-shapes.js";
import { bindEventWriterBackups } from "./cas-retention-backups.js";
import {
  CAS_RETENTION_SCAN,
  casReferenceFiles,
  type CasReferenceFile,
} from "./cas-retention-files.js";
import { scanReferenceFile, settleReferenceInventory } from "./cas-retention-settle.js";

export type { CasRetentionObservation } from "./cas-retention-observation.js";

/**
 * ADR-0660: `entry_yield` and `deferred` passes did no work and write no observation; `ran` covers
 * every pass that looked, including one that found nothing due.
 */
export type CasRetentionPassOutcome = "entry_yield" | "deferred" | "ran";

/** ADR-0660: a slice that spent its read budget either advanced a read or counts a stall. */
function noteReadBudget(
  observation: CasRetentionObservation,
  mark: ScanProgressMark,
  scan: RetentionScan,
  reference?: string,
) {
  if (scanAdvanced(mark, scan)) noteReadProgress(observation);
  else noteStall(observation, "read_budget_exhausted", reference);
  noteRemaining(observation, true);
}

/** Called only while holding the worker lock. The public boundary below acquires it for every host. */
async function collect(
  storage: ProjectStorage,
  observation: CasRetentionObservation,
  shouldYield: () => Promise<boolean>,
  admit: () => Promise<boolean>,
): Promise<CasRetentionPassOutcome> {
  if (
    storage.readOnly ||
    (await materializationTransactionState(storage.paths.repositoryRoot)) !== "clear" ||
    (await shouldYield())
  )
    return "entry_yield";
  const statePath = resolve(storage.paths.knowledgeState, CAS_RETENTION_SCAN);
  const scan = await readRetentionScan(statePath);
  noteRemaining(observation, false);
  if (scan.nextScanAt > Date.now()) return "ran";
  // ADR-0597: replaying the event log found nothing eligible at this head; ADR-0601: events with
  // no artifact lifecycle since then leave that answer standing, and roots extend the last replay.
  if (retentionStillIdle(scan, storage.events, Date.now())) return "ran";
  // ADR-0660: work is due, so it waits for this host's retention turn before it reads anything.
  if (!(await admit())) return "deferred";
  const sliceEndsAt = Date.now() + CAS_RETENTION_SLICE_MS;
  noteRemaining(observation, true);
  const roots = memoizedConvergenceArtifactRoots(storage.events);
  const files = await casReferenceFiles(storage);
  await bindEventWriterBackups(storage, roots.headSeq, files);
  const before = Date.parse(observation.observedAt) - CONVERGENCE_ARTIFACT_GRACE_MS;
  // Probes of live work run between reads and never spend the read budget (ADR-0584).
  const budget = referenceReadBudget(REFERENCE_SCAN_LIMITS, shouldYield);
  const records = presentRecords(scan.records ?? {}, files);
  scan.records = records;
  const mark = scanProgressMark(scan);
  if (!scan.eligible.length) {
    // A pass fixes its eligible set once, so every record must be classified before its scan.
    const classified = await classifyConvergenceRecords({
      files,
      lifecycle: roots.superseded,
      candidates: roots.candidates,
      before,
      shapes: records,
      budget,
    });
    if (classified.complete)
      scan.eligible = [
        ...new Set([
          ...eligibleConvergenceArtifacts(files, roots, before),
          ...releasedConvergenceRecords(files, roots.superseded, records, before).keys(),
        ]),
      ];
    if (!classified.complete) {
      noteReadBudget(observation, mark, scan);
      if (classified.changed) await saveScan(statePath, scan);
      return "ran";
    }
    if (!scan.eligible.length) {
      noteProgress(observation);
      noteRemaining(observation, false);
      await saveScan(statePath, {
        ...scan,
        idle: { head: roots.head, at: Date.now(), seq: roots.headSeq },
      });
      return "ran";
    }
  }
  const eligible = new Set(scan.eligible);
  const keys = new Set(files.map((file) => file.key));
  for (const key of Object.keys(scan.files)) if (!keys.has(key)) delete scan.files[key];
  for (const file of files) {
    if ((await scanReferenceFile(file, scan, eligible, budget, observation)) === "exhausted") {
      noteReadBudget(observation, mark, scan, file.path);
      await saveScan(statePath, scan);
      return "ran";
    }
  }
  const stallsBefore = observation.stalledPasses ?? 0;
  // ADR-0658: files that changed meanwhile are read again until the inventory holds still.
  const settled = await settleReferenceInventory({
    storage,
    scan,
    files,
    roots,
    eligible,
    records,
    before,
    budget,
    observation,
    shouldYield,
  });
  if (settled === null) {
    // Settling either counted its own stall or ran out of read budget.
    if ((observation.stalledPasses ?? 0) > stallsBefore) noteRemaining(observation, true);
    else noteReadBudget(observation, mark, scan);
    await saveScan(statePath, scan);
    return "ran";
  }
  const { deleted, remaining, headMoved } = await sweepUnreachableObjects({
    storage,
    files: settled.files,
    eligible,
    marked: settled.marked,
    released: settled.released,
    roots,
    before,
    observation,
    shouldYield,
    sliceEndsAt,
  });
  observation.status = "collected";
  noteSweep(observation, headMoved);
  noteRemaining(observation, remaining);
  if (!remaining) await expireTombstones(storage.paths.cas, Date.now());
  // A completed pass starts with a fresh grace horizon next time. Interruption can only leak bytes.
  for (const hash of deleted) {
    delete scan.files[hash];
    delete records[hash];
  }
  scan.eligible = scan.eligible.filter((hash) => !deleted.has(hash));
  await saveScan(
    statePath,
    remaining
      ? scan
      : {
          schemaVersion: 1,
          nextScanAt: Date.now() + 24 * 60 * 60 * 1000,
          eligible: [],
          files: {},
          reports: {},
          records,
        },
  );
  return "ran";
}

/** Shapes outlive a pass only while their object exists. */
function presentRecords(
  records: ConvergenceRecordShapes,
  files: readonly CasReferenceFile[],
): ConvergenceRecordShapes {
  const present = new Set(files.flatMap((file) => (file.hash === null ? [] : [file.hash])));
  return Object.fromEntries(Object.entries(records).filter(([hash]) => present.has(hash)));
}

/**
 * Best-effort host-local maintenance: no wait for a worker, provider call, or developer lease.
 * `admit` is asked once work is due and before any read (ADR-0660); null means the lock was busy.
 */
export async function runCasRetentionPass(
  storage: ProjectStorage,
  shouldYield: () => Promise<boolean> = async () => false,
  admit: () => Promise<boolean> = async () => true,
): Promise<{ observation: CasRetentionObservation; outcome: CasRetentionPassOutcome } | null> {
  if (storage.readOnly) return null;
  const result = await withRepositoryKnowledgeWorkerLock(storage.paths.repositoryRoot, async () => {
    const observation = await startObservation(storage);
    let outcome: CasRetentionPassOutcome = "ran";
    try {
      outcome = await collect(storage, observation, shouldYield, admit);
    } catch (error) {
      observation.status = "unavailable";
      observation.remaining = false;
      Object.assign(observation, classifyRetentionFailure(error));
    }
    // ADR-0660: a pass that did no work leaves the last observation, its age and its answer.
    if (outcome === "ran") await writeObservation(storage, observation);
    return { observation, outcome };
  });
  return result.status === "busy" ? null : result.result;
}

/** One pass with no host turn, as one-shot commands and tests run it. */
export async function compactProjectConvergenceArtifacts(
  storage: ProjectStorage,
  shouldYield: () => Promise<boolean> = async () => false,
): Promise<CasRetentionObservation | null> {
  return (await runCasRetentionPass(storage, shouldYield))?.observation ?? null;
}
