import { readRetentionScan, saveScan } from "./cas-retention-state.js";
import { memoizedConvergenceArtifactRoots, retentionStillIdle } from "./cas-retention-memo.js";
import { resolve } from "node:path";

import type { ProjectStorage } from "@lervo/project-storage";
import { withRepositoryKnowledgeWorkerLock } from "@lervo/repository-knowledge-compiler";
import { materializationTransactionState } from "./materialization-transaction.js";
import {
  classifyRetentionFailure,
  noteProgress,
  noteSweep,
  startObservation,
  writeObservation,
  type CasRetentionObservation,
} from "./cas-retention-observation.js";
import { expireTombstones } from "./cas-retention-tombstones.js";
import { REFERENCE_SCAN_LIMITS, referenceReadBudget } from "./cas-retention-budget.js";
import {
  CONVERGENCE_ARTIFACT_GRACE_MS,
  eligibleConvergenceArtifacts,
  retentionNamedAt,
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
  removeUnreachableCasObject,
  type CasReferenceFile,
} from "./cas-retention-files.js";
import { scanReferenceFile, settleReferenceInventory } from "./cas-retention-settle.js";

export type { CasRetentionObservation } from "./cas-retention-observation.js";

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
  let files = await casReferenceFiles(storage);
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
  const keys = new Set(files.map((file) => file.key));
  for (const key of Object.keys(scan.files)) if (!keys.has(key)) delete scan.files[key];
  for (const file of files) {
    if ((await scanReferenceFile(file, scan, eligible, budget, observation)) === "exhausted") {
      await saveScan(statePath, scan);
      return;
    }
  }
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
    await saveScan(statePath, scan);
    return;
  }
  const { marked, released } = settled;
  files = settled.files;
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
