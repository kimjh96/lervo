import { collectReportReferences } from "./cas-retention-reports.js";
import { readRetentionScan, saveScan, writeRetentionProjection } from "./cas-retention-state.js";
import { resolve } from "node:path";

import type { ProjectStorage } from "@lervo/project-storage";
import { withRepositoryKnowledgeWorkerLock } from "@lervo/repository-knowledge-compiler";
import { materializationTransactionState } from "./materialization-transaction.js";
import { convergenceArtifactRoots, reachableConvergenceArtifacts } from "./cas-retention-policy.js";
import {
  CAS_RETENTION_OBSERVATION,
  CAS_RETENTION_SCAN,
  casReferenceFiles,
  scanReferenceChunk,
  removeUnreachableCasObject,
} from "./cas-retention-files.js";

const GRACE_MS = 14 * 24 * 60 * 60 * 1000;

export interface CasRetentionObservation {
  schemaVersion: 1;
  observedAt: string;
  status: "yielded" | "collected" | "unavailable";
  removedObjects: number;
  reclaimedBytes: number;
}

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
  const roots = convergenceArtifactRoots(storage.events);
  const files = await casReferenceFiles(storage);
  if (!scan.eligible.length) {
    const before = Date.parse(observation.observedAt) - GRACE_MS;
    scan.eligible = files
      .filter(
        (file) =>
          file.hash !== null &&
          file.modifiedAt < before &&
          (roots.candidates.get(file.hash) ?? Infinity) < before,
      )
      .map((file) => file.hash!);
  }
  const eligible = new Set(scan.eligible);
  if (!eligible.size) return;
  const keys = new Set(files.map((file) => file.key));
  for (const key of Object.keys(scan.files)) if (!keys.has(key)) delete scan.files[key];
  let chunks = 0;
  let scannedBytes = 0;
  const started = Date.now();
  for (const file of files) {
    let entry = scan.files[file.key];
    if (!entry || entry.identity !== file.identity)
      entry = { identity: file.identity, complete: false, offset: 0, tail: "", references: [] };
    while (!entry.complete) {
      const remainingBytes = 8 * 1024 * 1024 - scannedBytes;
      if (
        chunks >= 64 ||
        remainingBytes <= 0 ||
        (file.hash === null &&
          /\.(?:sqlite|db)$/u.test(file.path) &&
          remainingBytes < 1024 * 1024) ||
        Date.now() - started >= 100 ||
        (await shouldYield())
      ) {
        await saveScan(statePath, scan);
        return;
      }
      const read = await scanReferenceChunk(file, entry, eligible, remainingBytes);
      entry = read.scan;
      scannedBytes += read.bytesRead;
      scan.files[file.key] = entry;
      chunks++;
    }
    scan.files[file.key] = entry;
  }
  const reachable = new Set(roots.reachable);
  const edges = new Map<string, string[]>();
  for (const file of files) {
    const references = scan.files[file.key]!.references;
    if (file.hash !== null && eligible.has(file.hash)) edges.set(file.hash, references);
    else for (const hash of references) reachable.add(hash);
  }
  if (
    !(await collectReportReferences({
      storage,
      roots,
      reachable,
      scan,
      casHashes: new Set(files.flatMap((file) => (file.hash === null ? [] : [file.hash]))),
      deadline: started + 100,
      shouldYield,
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
    await saveScan(statePath, scan);
    return;
  }
  const deleted = new Set<string>();
  let remaining = false;
  for (const file of files) {
    if (
      file.hash === null ||
      !eligible.has(file.hash) ||
      marked.has(file.hash) ||
      file.modifiedAt >= Date.parse(observation.observedAt) - GRACE_MS ||
      (roots.candidates.get(file.hash) ?? Infinity) >= Date.parse(observation.observedAt) - GRACE_MS
    )
      continue;
    if (
      observation.removedObjects >= 32 ||
      (await shouldYield()) ||
      (storage.events.latest()?.eventHash ?? null) !== roots.head
    ) {
      remaining = true;
      break;
    }
    if ((await materializationTransactionState(storage.paths.repositoryRoot)) !== "clear") {
      remaining = true;
      break;
    }
    await removeUnreachableCasObject(file, () => {
      if ((storage.events.latest()?.eventHash ?? null) !== roots.head)
        throw new Error("CAS reference event head changed before unlink.");
    });
    deleted.add(file.hash);
    observation.removedObjects++;
    observation.reclaimedBytes += file.size;
  }
  observation.status = "collected";
  // A completed pass starts with a fresh grace horizon next time. Interruption can only leak bytes.
  for (const hash of deleted) delete scan.files[hash];
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
        },
  );
}

/** Best-effort host-local maintenance: no wait for a worker, provider call, or developer lease. */
export async function compactProjectConvergenceArtifacts(
  storage: ProjectStorage,
  shouldYield: () => Promise<boolean> = async () => false,
): Promise<CasRetentionObservation | null> {
  if (storage.readOnly) return null;
  const result = await withRepositoryKnowledgeWorkerLock(storage.paths.repositoryRoot, async () => {
    const observation: CasRetentionObservation = {
      schemaVersion: 1,
      observedAt: new Date().toISOString(),
      status: "yielded",
      removedObjects: 0,
      reclaimedBytes: 0,
    };
    try {
      await collect(storage, observation, shouldYield);
    } catch {
      observation.status = "unavailable";
    }
    await writeRetentionProjection(
      resolve(storage.paths.knowledgeState, CAS_RETENTION_OBSERVATION),
      observation,
    );
    return observation;
  });
  return result.status === "busy" ? null : result.result;
}
