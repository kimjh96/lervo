import { collectReportReferences } from "./cas-retention-reports.js";
import { readRetentionScan, saveScan } from "./cas-retention-state.js";
import { memoizedConvergenceArtifactRoots, retentionStillIdle } from "./cas-retention-memo.js";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import type { ProjectStorage } from "@lervo/project-storage";
import { withRepositoryKnowledgeWorkerLock } from "@lervo/repository-knowledge-compiler";
import { materializationTransactionState } from "./materialization-transaction.js";
import {
  classifyRetentionFailure,
  noteProgress,
  noteStall,
  noteSweep,
  startObservation,
  writeObservation,
  type CasRetentionObservation,
} from "./cas-retention-observation.js";
import { expireTombstones } from "./cas-retention-tombstones.js";
import {
  REFERENCE_SCAN_LIMITS,
  REPORT_READ_LIMITS,
  referenceReadBudget,
} from "./cas-retention-budget.js";
import {
  CONVERGENCE_ARTIFACT_GRACE_MS,
  eligibleConvergenceArtifacts,
  reachableConvergenceArtifacts,
  retentionNamedAt,
  retentionReferenceGraph,
} from "./cas-retention-policy.js";
import { classifyConvergenceRecords } from "./cas-retention-records.js";
import {
  releasedConvergenceRecords,
  type ConvergenceRecordShapes,
} from "./cas-retention-record-shapes.js";
import { bindEventWriterBackups } from "./cas-retention-backups.js";
import {
  CAS_RETENTION_SCAN,
  casReferenceFiles,
  referenceFile,
  scanReferenceChunk,
  removeUnreachableCasObject,
  type CasReferenceFile,
  type ReferenceChunkRead,
  type ReferenceScan,
} from "./cas-retention-files.js";

export type { CasRetentionObservation } from "./cas-retention-observation.js";

/**
 * How often one cycle reads a file again that changed while it was read, waiting 50, 100 and then
 * 200 ms first so a database between write-ahead-log commits can settle (ADR-0658).
 */
const IMMEDIATE_RESCANS = 3;
const RESCAN_BACKOFF_MS = 50;

/** Called only while holding the worker lock. The public boundary below acquires it for every host. */
async function collect(
  storage: ProjectStorage,
  observation: CasRetentionObservation,
  shouldYield: () => Promise<boolean>,
): Promise<void> {
  if (
    storage.readOnly ||
    (await materializationTransactionState(storage.paths.repositoryRoot)) !== "clear" ||
    (await shouldYield())
  )
    return;
  const statePath = resolve(storage.paths.knowledgeState, CAS_RETENTION_SCAN);
  const scan = await readRetentionScan(statePath);
  if (scan.nextScanAt > Date.now()) return;
  // ADR-0597: replaying the event log found nothing eligible at this head; ADR-0601: events with
  // no artifact lifecycle since then leave that answer standing, and roots extend the last replay.
  if (retentionStillIdle(scan, storage.events, Date.now())) return;
  const roots = memoizedConvergenceArtifactRoots(storage.events);
  const files = await casReferenceFiles(storage);
  await bindEventWriterBackups(storage, roots.headSeq, files);
  const before = Date.parse(observation.observedAt) - CONVERGENCE_ARTIFACT_GRACE_MS;
  // Probes of live work run between reads and never spend the read budget (ADR-0584).
  const budget = referenceReadBudget(REFERENCE_SCAN_LIMITS, shouldYield);
  const records = presentRecords(scan.records ?? {}, files);
  scan.records = records;
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
      if (classified.changed) await saveScan(statePath, scan);
      return;
    }
    if (!scan.eligible.length) {
      noteProgress(observation);
      await saveScan(statePath, {
        ...scan,
        idle: { head: roots.head, at: Date.now(), seq: roots.headSeq },
      });
      return;
    }
  }
  const eligible = new Set(scan.eligible);
  const released = releasedConvergenceRecords(files, roots.superseded, records, before);
  const keys = new Set(files.map((file) => file.key));
  for (const key of Object.keys(scan.files)) if (!keys.has(key)) delete scan.files[key];
  let restarted = false;
  for (const file of files) {
    const outcome = await scanReferenceFile(file, scan, eligible, budget, observation);
    if (outcome === "exhausted") {
      await saveScan(statePath, scan);
      return;
    }
    if (outcome === "restarted") restarted = true;
  }
  if (restarted) {
    await saveScan(statePath, scan);
    return;
  }
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
      budget: referenceReadBudget(REPORT_READ_LIMITS, shouldYield),
    }))
  ) {
    await saveScan(statePath, scan);
    return;
  }
  const marked = reachableConvergenceArtifacts(reachable, edges);
  const currentFiles = await casReferenceFiles(storage);
  if (
    JSON.stringify(files.map((file) => [file.key, file.identity])) !==
    JSON.stringify(currentFiles.map((file) => [file.key, file.identity]))
  ) {
    noteStall(observation, "inventory_changed");
    await saveScan(statePath, scan);
    return;
  }
  const deleted = new Set<string>();
  let remaining = false;
  let headMoved = false;
  const headCurrent = () => (storage.events.latest()?.eventHash ?? null) === roots.head;
  for (const file of files) {
    if (
      file.hash === null ||
      !eligible.has(file.hash) ||
      marked.has(file.hash) ||
      file.modifiedAt >= before ||
      retentionNamedAt(roots, released, file.hash) >= before
    )
      continue;
    if (observation.removedObjects >= 32 || (await shouldYield()) || !headCurrent()) {
      headMoved = !headCurrent();
      remaining = true;
      break;
    }
    if ((await materializationTransactionState(storage.paths.repositoryRoot)) !== "clear") {
      remaining = true;
      break;
    }
    // ADR-0658: the head is checked again after the tombstone, right before the unlink.
    if (!(await removeUnreachableCasObject(file, headCurrent, storage.paths.cas))) {
      headMoved = remaining = true;
      break;
    }
    deleted.add(file.hash);
    observation.removedObjects++;
    observation.reclaimedBytes += file.size;
  }
  observation.status = "collected";
  noteSweep(observation, headMoved);
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

/**
 * Reads one reference file's body to completion within the cycle's budget. A live writer that
 * replaced, removed or locked it makes the pass read it again from its new identity, a few times,
 * so one busy file cannot hold every pass back forever (ADR-0658). The caller's final inventory
 * comparison still binds every identity before any unlink.
 */
async function scanReferenceFile(
  file: CasReferenceFile,
  scan: Awaited<ReturnType<typeof readRetentionScan>>,
  eligible: ReadonlySet<string>,
  budget: ReturnType<typeof referenceReadBudget>,
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
    if (rescans < IMMEDIATE_RESCANS) await delay(RESCAN_BACKOFF_MS * 2 ** rescans);
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

/** Shapes outlive a pass only while their object exists. */
function presentRecords(
  records: ConvergenceRecordShapes,
  files: readonly CasReferenceFile[],
): ConvergenceRecordShapes {
  const present = new Set(files.flatMap((file) => (file.hash === null ? [] : [file.hash])));
  return Object.fromEntries(Object.entries(records).filter(([hash]) => present.has(hash)));
}

/** Best-effort host-local maintenance: no wait for a worker, provider call, or developer lease. */
export async function compactProjectConvergenceArtifacts(
  storage: ProjectStorage,
  shouldYield: () => Promise<boolean> = async () => false,
): Promise<CasRetentionObservation | null> {
  if (storage.readOnly) return null;
  const result = await withRepositoryKnowledgeWorkerLock(storage.paths.repositoryRoot, async () => {
    const observation = await startObservation(storage);
    try {
      await collect(storage, observation, shouldYield);
    } catch (error) {
      observation.status = "unavailable";
      Object.assign(observation, classifyRetentionFailure(error));
    }
    await writeObservation(storage, observation);
    return observation;
  });
  return result.status === "busy" ? null : result.result;
}
