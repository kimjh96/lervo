import { collectReportReferences } from "./cas-retention-reports.js";
import { readRetentionScan, saveScan, writeRetentionProjection } from "./cas-retention-state.js";
import { resolve } from "node:path";

import type { ProjectStorage } from "@lervo/project-storage";
import { withRepositoryKnowledgeWorkerLock } from "@lervo/repository-knowledge-compiler";
import { materializationTransactionState } from "./materialization-transaction.js";
import { CasRetentionBoundError } from "./cas-retention-errors.js";
import {
  REFERENCE_SCAN_LIMITS,
  REPORT_READ_LIMITS,
  referenceReadBudget,
} from "./cas-retention-budget.js";
import { convergenceArtifactRoots, reachableConvergenceArtifacts } from "./cas-retention-policy.js";
import {
  CAS_RETENTION_OBSERVATION,
  CAS_RETENTION_SCAN,
  casReferenceFiles,
  scanReferenceChunk,
  removeUnreachableCasObject,
  type ReferenceChunkRead,
  type ReferenceScan,
} from "./cas-retention-files.js";

const GRACE_MS = 14 * 24 * 60 * 60 * 1000;

export interface CasRetentionObservation {
  schemaVersion: 1;
  observedAt: string;
  status: "yielded" | "collected" | "unavailable";
  /**
   * Set only with `unavailable` (ADR-0584): `bound_exceeded` names a finite collector bound, and
   * `failed` any other stop. Neither carries a path, hash or exception text.
   */
  failure: "bound_exceeded" | "failed" | null;
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
  // Probes of live work run between reads and never spend the read budget (ADR-0584).
  const budget = referenceReadBudget(REFERENCE_SCAN_LIMITS, shouldYield);
  let restarted = false;
  for (const file of files) {
    const cached = scan.files[file.key];
    let entry: ReferenceScan =
      cached !== undefined && cached.identity === file.identity
        ? cached
        : { identity: file.identity, complete: false, offset: 0, tail: "", references: [] };
    while (!entry.complete) {
      const sqlite = file.hash === null && /\.(?:sqlite|db)$/u.test(file.path);
      if (await budget.exhausted(sqlite ? 1024 * 1024 : 1)) {
        await saveScan(statePath, scan);
        return;
      }
      const prior: ReferenceScan = entry;
      const read: ReferenceChunkRead | null = await budget.read(
        (): Promise<ReferenceChunkRead | null> =>
          scanReferenceChunk(file, prior, eligible, budget.remainingBytes()),
        (result: ReferenceChunkRead | null): number => result?.bytesRead ?? 0,
      );
      // A live writer replaced, removed or locked it: restart this file next cycle, keep the rest.
      if (read === null) {
        delete scan.files[file.key];
        restarted = true;
        break;
      }
      entry = read.scan;
      scan.files[file.key] = entry;
    }
  }
  if (restarted) {
    await saveScan(statePath, scan);
    return;
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
      failure: null,
      removedObjects: 0,
      reclaimedBytes: 0,
    };
    try {
      await collect(storage, observation, shouldYield);
    } catch (error) {
      observation.status = "unavailable";
      observation.failure = error instanceof CasRetentionBoundError ? "bound_exceeded" : "failed";
    }
    await writeRetentionProjection(
      resolve(storage.paths.knowledgeState, CAS_RETENTION_OBSERVATION),
      observation,
    );
    return observation;
  });
  return result.status === "busy" ? null : result.result;
}
