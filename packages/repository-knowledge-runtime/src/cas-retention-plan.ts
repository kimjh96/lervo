import type { ProjectStorage } from "@lervo/project-storage";
import { bindEventWriterBackups } from "./cas-retention-backups.js";
import { referenceReadBudget } from "./cas-retention-budget.js";
import { CasRetentionBoundError } from "./cas-retention-errors.js";
import {
  casReferenceFiles,
  referenceFile,
  scanReferenceChunk,
  type CasReferenceFile,
  type ReferenceScan,
} from "./cas-retention-files.js";
import {
  CONVERGENCE_ARTIFACT_GRACE_MS,
  convergenceArtifactRoots,
  eligibleConvergenceArtifacts,
  reachableConvergenceArtifacts,
  retentionNamedAt,
  retentionReferenceGraph,
  type CasRetentionRoots,
} from "./cas-retention-policy.js";
import { collectReportReferences } from "./cas-retention-reports.js";
import { classifyConvergenceRecords } from "./cas-retention-records.js";
import {
  releasedConvergenceRecords,
  type ConvergenceRecordShapes,
  type ReleasedRecord,
  type SupersededRecordReason,
} from "./cas-retention-record-shapes.js";
import type { RetentionScan } from "./cas-retention-state.js";

export interface CasRetentionTally {
  objects: number;
  bytes: number;
}

/**
 * Read-only estimate of one completed retention pass (ADR-0585, ADR-0586). It names no path, hash
 * or body. `collectable` counts what the policy would release, before the per-cycle cap.
 */
export interface CasRetentionPlan {
  schemaVersion: 1;
  observedAt: string;
  status: "planned" | "unavailable";
  /** `reference_changed`: a live writer kept replacing a reference file; rerun the plan. */
  failure: "reference_changed" | "bound_exceeded" | "failed" | null;
  casObjects: number;
  casBytes: number;
  /** Convergence candidates and released superseded records past the grace period. */
  candidates: CasRetentionTally;
  retained: CasRetentionTally;
  collectable: CasRetentionTally & {
    byReason: {
      /** Collectable under ADR-0534 alone. */
      unreferenced: CasRetentionTally;
      /** Kept before only by event-writer backup events that the live log mirrors. */
      event_writer_backup: CasRetentionTally;
      /** Kept before only by settled `assignment.created` inputs or their archives. */
      assignment_input: CasRetentionTally;
      /** Kept before by both, so only the two rules together release it. */
      backup_and_assignment_input: CasRetentionTally;
      /**
       * ADR-0586: superseded stage results, then candidates that only they kept. A candidate that
       * only failures or observations kept counts under that reason, in this order.
       */
      stage_result_superseded: CasRetentionTally;
      failure_superseded: CasRetentionTally;
      observation_superseded: CasRetentionTally;
    };
  };
}

const UNBOUNDED = {
  maximumReads: Number.MAX_SAFE_INTEGER,
  maximumBytes: Number.MAX_SAFE_INTEGER,
  maximumWorkMs: Number.POSITIVE_INFINITY,
};
/** A file replaced this many times in a row reports `reference_changed` instead of a guess. */
const MAXIMUM_FILE_ATTEMPTS = 3;

const tally = (): CasRetentionTally => ({ objects: 0, bytes: 0 });

function emptyPlan(observedAt: string): CasRetentionPlan {
  return {
    schemaVersion: 1,
    observedAt,
    status: "planned",
    failure: null,
    casObjects: 0,
    casBytes: 0,
    candidates: tally(),
    retained: tally(),
    collectable: {
      ...tally(),
      byReason: {
        unreferenced: tally(),
        event_writer_backup: tally(),
        assignment_input: tally(),
        backup_and_assignment_input: tally(),
        stage_result_superseded: tally(),
        failure_superseded: tally(),
        observation_superseded: tally(),
      },
    },
  };
}

async function scanWholeFile(
  inventoried: CasReferenceFile,
  eligible: ReadonlySet<string>,
): Promise<readonly string[] | null> {
  let file = inventoried;
  for (let attempt = 0; attempt < MAXIMUM_FILE_ATTEMPTS; attempt++) {
    let entry: ReferenceScan | null = {
      identity: file.identity,
      complete: false,
      offset: 0,
      tail: "",
      references: [],
    };
    while (entry !== null && !entry.complete)
      entry = (await scanReferenceChunk(file, entry, eligible))?.scan ?? null;
    if (entry !== null) return entry.references;
    // A live writer replaced it since the inventory: read its current bytes, or nothing if gone.
    try {
      file = { ...file, ...(await referenceFile(file.path, file.hash)) };
    } catch (error) {
      if ((error as NodeJS.ErrnoException | null)?.code === "ENOENT") return [];
      throw error;
    }
  }
  return null;
}

/** Marks from `roots` plus every immutable report they reach, exactly as the collector does. */
async function marked(
  storage: ProjectStorage,
  roots: CasRetentionRoots,
  seeds: Iterable<string>,
  edges: ReadonlyMap<string, readonly string[]>,
  casHashes: ReadonlySet<string>,
  reports: RetentionScan,
): Promise<Set<string>> {
  const reachable = new Set(seeds);
  await collectReportReferences({
    storage,
    roots,
    reachable,
    scan: reports,
    casHashes,
    budget: referenceReadBudget(UNBOUNDED, async () => false),
  });
  return reachableConvergenceArtifacts(reachable, edges);
}

function onlyReasons(
  released: ReadonlyMap<string, ReleasedRecord>,
  reasons: readonly SupersededRecordReason[],
): Map<string, ReleasedRecord> {
  return new Map([...released].filter(([, record]) => reasons.includes(record.reason)));
}

async function plan(storage: ProjectStorage, observedAt: string): Promise<CasRetentionPlan> {
  const result = emptyPlan(observedAt);
  const roots = convergenceArtifactRoots(storage.events);
  const files = await casReferenceFiles(storage);
  const mirrored = new Set<string>();
  await bindEventWriterBackups(storage, roots.headSeq, files, mirrored);
  const objects = files.filter((file) => file.hash !== null);
  result.casObjects = objects.length;
  result.casBytes = objects.reduce((total, file) => total + file.size, 0);
  const before = Date.parse(observedAt) - CONVERGENCE_ARTIFACT_GRACE_MS;
  const records: ConvergenceRecordShapes = {};
  await classifyConvergenceRecords({
    files,
    lifecycle: roots.superseded,
    candidates: roots.candidates,
    before,
    shapes: records,
    budget: referenceReadBudget(UNBOUNDED, async () => false),
  });
  const released = releasedConvergenceRecords(files, roots.superseded, records, before);
  const eligible = new Set([
    ...eligibleConvergenceArtifacts(files, roots, before),
    ...released.keys(),
  ]);
  if (!eligible.size) return result;
  const references = new Map<string, readonly string[]>();
  for (const file of files) {
    const found = await scanWholeFile(file, eligible);
    if (found === null) return { ...result, status: "unavailable", failure: "reference_changed" };
    references.set(file.key, found);
  }
  const graph = (releasing: ReadonlyMap<string, ReleasedRecord>) =>
    retentionReferenceGraph(files, (file) => references.get(file.key)!, roots, eligible, releasing);
  // ADR-0534 also rooted assignment inputs, the inputs inside their archives, and backup events.
  const assignmentRoots = new Set(roots.assignmentInputs);
  for (const [archive, input] of roots.archiveInputs)
    if (references.get(archive)?.includes(input)) assignmentRoots.add(input);
  const casHashes = new Set(objects.map((file) => file.hash!));
  const reports: RetentionScan = {
    schemaVersion: 1,
    nextScanAt: 0,
    eligible: [],
    files: {},
    reports: {},
  };
  const mark = ({ reachable, edges }: ReturnType<typeof graph>, extra: Iterable<string>[] = []) =>
    marked(
      storage,
      roots,
      [reachable, ...extra].flatMap((set) => [...set]),
      edges,
      casHashes,
      reports,
    );
  // ADR-0585 kept every superseded record; each later graph releases one more kind (ADR-0586).
  const kept = graph(new Map());
  const current = await mark(graph(released));
  const withoutSupersededRule = await mark(kept);
  const legacy = await mark(kept, [mirrored, assignmentRoots]);
  const withoutBackupRule = await mark(kept, [mirrored]);
  const withoutAssignmentRule = await mark(kept, [assignmentRoots]);
  const stageOnly = await mark(graph(onlyReasons(released, ["stage_result_superseded"])));
  const withoutObservationRule = await mark(
    graph(onlyReasons(released, ["stage_result_superseded", "failure_superseded"])),
  );
  const add = (target: CasRetentionTally, size: number) => {
    target.objects++;
    target.bytes += size;
  };
  for (const file of objects) {
    const hash = file.hash!;
    if (!eligible.has(hash)) continue;
    add(result.candidates, file.size);
    // As in the collector's sweep, the latest naming record must also be past grace.
    if (current.has(hash) || retentionNamedAt(roots, released, hash) >= before) {
      add(result.retained, file.size);
      continue;
    }
    add(result.collectable, file.size);
    const reasons = result.collectable.byReason;
    const record = released.get(hash);
    if (record !== undefined) add(reasons[record.reason], file.size);
    else if (withoutSupersededRule.has(hash)) {
      if (!stageOnly.has(hash)) add(reasons.stage_result_superseded, file.size);
      else if (!withoutObservationRule.has(hash)) add(reasons.failure_superseded, file.size);
      else add(reasons.observation_superseded, file.size);
    } else if (!legacy.has(hash)) add(reasons.unreferenced, file.size);
    else if (!withoutAssignmentRule.has(hash)) add(reasons.event_writer_backup, file.size);
    else if (!withoutBackupRule.has(hash)) add(reasons.assignment_input, file.size);
    else add(reasons.backup_and_assignment_input, file.size);
  }
  return result;
}

/**
 * Read-only: no worker lock, scan projection, observation or unlink. It applies the collector's
 * policy to one full scan, so a concurrent writer can only make the estimate stale.
 */
export async function planProjectConvergenceArtifactRetention(
  storage: ProjectStorage,
  now: Date = new Date(),
): Promise<CasRetentionPlan> {
  const observedAt = now.toISOString();
  try {
    return await plan(storage, observedAt);
  } catch (error) {
    return {
      ...emptyPlan(observedAt),
      status: "unavailable",
      failure: error instanceof CasRetentionBoundError ? "bound_exceeded" : "failed",
    };
  }
}
