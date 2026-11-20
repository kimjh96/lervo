import { replayKnowledgeConvergence } from "@lervo/repository-knowledge";
import type { EventEnvelope } from "@lervo/schemas";
import { visitEventSnapshot, type OutboxStore } from "@lervo/storage-contract";
import { CasRetentionBoundError } from "./cas-retention-errors.js";
import { casReferences } from "./cas-retention-references.js";
import type { CasReferenceFile } from "./cas-retention-files.js";
import {
  archivedAssignmentInput,
  convergenceAssignmentInput,
  type ConvergenceAssignmentInput,
} from "./cas-retention-assignment-inputs.js";
import type { ReleasedRecord } from "./cas-retention-record-shapes.js";
import {
  trackSupersededLifecycle,
  type ObligationStageState,
  type SupersededLifecycle,
} from "./cas-retention-superseded.js";

const CONVERGENCE = new Set([
  "repository.knowledge.baseline.requested",
  "repository.knowledge.stage.recorded",
  "repository.knowledge.convergence.recorded",
]);
const ARTIFACT_FIELDS = [
  "inputArtifactHash",
  "resultArtifactHash",
  "dependencyHash",
  "evidenceHash",
];

/** A candidate and its bytes must both be older than this before collection (ADR-0534). */
export const CONVERGENCE_ARTIFACT_GRACE_MS = 14 * 24 * 60 * 60 * 1000;

/** Bounds the distinct references the inventory retains, never the length of history (ADR-0554). */
const maximumRetainedReferences = 200_000;
export const MAXIMUM_RETAINED_CAS_REFERENCES = maximumRetainedReferences;

/**
 * ADR-0601: whether an event can change more than the plain roots. Convergence records, every
 * assignment event and any event naming an assignment take part in a lifecycle that can release
 * artifacts; any other event only roots the references in its payload.
 */
export function retentionLifecycleEvent(event: EventEnvelope): boolean {
  return (
    CONVERGENCE.has(event.type) ||
    event.type.startsWith("assignment.") ||
    typeof event.payload.assignmentId === "string"
  );
}

export interface CasRetentionRoots {
  head: string | null;
  /** Sequence of `head`; event-writer backups are compared only within this snapshot. */
  headSeq: number;
  candidates: Map<string, number>;
  reachable: Set<string>;
  lastReference: Map<string, number>;
  /**
   * Inputs that ADR-0534 rooted through `assignment.created` and ADR-0585 keeps only while their
   * obligation is open or they belong to its latest settled stage. Plans report them; the
   * collector never roots them.
   */
  assignmentInputs: Set<string>;
  /** Archive CAS object hash to the archived assignment's input, which the archive never roots. */
  archiveInputs: Map<string, string>;
  /** Archive CAS object hash to its assignment; it never roots that assignment's released records. */
  archiveOwners: Map<string, string>;
  /** Convergence assignments outside their settled obligation's latest stage (ADR-0586). */
  superseded: SupersededLifecycle;
}

/**
 * Non-convergence event payloads remain roots, regardless of their lifecycle or age, except the
 * stage input that `assignment.created` names (ADR-0585). Every payload can name an artifact, so
 * the scan streams the verified snapshot through the observed head and retains only references.
 */
export function convergenceArtifactRoots(events: OutboxStore): CasRetentionRoots {
  const observed = events.latest();
  const head = observed?.eventHash ?? null;
  replayKnowledgeConvergence(events);
  const candidates = new Map<string, number>();
  const reachable = new Set<string>();
  const lastReference = new Map<string, number>();
  const obligations = new Map<string, ObligationStageState & { all: string[] }>();
  const assignments = new Map<string, ConvergenceAssignmentInput>();
  const assignmentInputs = new Set<string>();
  const assignmentNamedAt = new Map<string, number>();
  const archiveInputs = new Map<string, string>();
  const archiveOwners = new Map<string, string>();
  const lifecycle = trackSupersededLifecycle(maximumRetainedReferences);
  let parked: string[] = [];
  const obligation = (id: string) => {
    let row = obligations.get(id);
    if (!row) {
      row = { settled: false, latest: [], latestAssignment: null, all: [] };
      obligations.set(id, row);
    }
    return row;
  };
  const visit = (event: EventEnvelope) => {
    const refs = casReferences(JSON.stringify(event.payload));
    for (const hash of refs) lastReference.set(hash, event.seq);
    if (
      lastReference.size > maximumRetainedReferences ||
      assignments.size > maximumRetainedReferences
    )
      throw new CasRetentionBoundError("CAS event reference inventory exceeds its bound.");
    const root = () => {
      for (const hash of refs) reachable.add(hash);
    };
    const input = convergenceAssignmentInput(event);
    if (input !== null) {
      assignments.set(input.assignmentId, input);
      for (const hash of input.otherReferences) reachable.add(hash);
      assignmentNamedAt.set(input.hash, Math.max(assignmentNamedAt.get(input.hash) ?? 0, input.at));
      const row = obligation(input.obligationId);
      lifecycle.created(input, row.settled);
      if (input.otherReferences.includes(input.hash)) return;
      assignmentInputs.add(input.hash);
      // An input named after its obligation settled has no stage lifecycle left: keep it.
      if (row.settled) reachable.add(input.hash);
      else row.all.push(input.hash);
      return;
    }
    if (!CONVERGENCE.has(event.type)) {
      const archived = archivedAssignmentInput(event, assignments);
      if (archived !== null) {
        archiveInputs.set(archived.archiveHash, archived.inputHash);
        archiveOwners.set(archived.archiveHash, archived.assignmentId);
      }
      // A convergence assignment's own events root only once its stage is known (ADR-0586).
      if (!lifecycle.defer(event, refs)) root();
      return;
    }
    const id = event.payload.obligationId;
    if (typeof id !== "string") throw new Error("Convergence retention identity is invalid.");
    const row = obligation(id);
    row.all.push(...refs);
    for (const field of ARTIFACT_FIELDS) {
      const value = event.payload[field];
      if (typeof value === "string" && /^sha256:[a-f0-9]{64}$/u.test(value)) {
        const at = Date.parse(event.occurredAt);
        if (!Number.isFinite(at)) throw new Error("Convergence retention time is invalid.");
        candidates.set(value.slice(7), Math.max(candidates.get(value.slice(7)) ?? 0, at));
      }
    }
    if (event.type === "repository.knowledge.stage.recorded") {
      if (event.payload.state !== "queued" && event.payload.state !== "running") {
        row.latest = refs;
        const assignmentId = event.payload.assignmentId;
        row.latestAssignment = typeof assignmentId === "string" ? assignmentId : null;
      }
      // These proofs are historical consumers, not disposable stage diagnostics. The canonical
      // disposition ledger replays every integrated batch's input and result, and later stages
      // always follow `canonical_integration`, so the latest settled stage never covers it.
      if (
        (event.payload.stage === "normalization_apply" ||
          event.payload.stage === "canonical_integration") &&
        event.payload.state === "current"
      )
        root();
      if (event.payload.failureCode === "knowledge_sources_parked") parked = refs;
    }
    if (event.type === "repository.knowledge.convergence.recorded") {
      row.settled = true;
      row.all = [];
      // historicalObligations reads every successful terminal lifecycle receipt.
      root();
    }
  };
  if (observed !== null)
    visitEventSnapshot({
      events,
      throughSeq: observed.seq,
      throughHash: observed.eventHash,
      visit,
    });
  for (const row of obligations.values())
    for (const hash of row.settled ? row.latest : row.all) reachable.add(hash);
  for (const hash of parked) reachable.add(hash);
  const superseded = lifecycle.finish(obligations, (hash) => reachable.add(hash));
  // The grace period runs from the latest record that names a candidate, assignments included.
  for (const [hash, at] of assignmentNamedAt) {
    const named = candidates.get(hash);
    if (named !== undefined) candidates.set(hash, Math.max(named, at));
  }
  // The visit ends exactly at `head`. A later append leaves this snapshot exact; the sweep fences
  // every unlink on `head`, so a busy writer defers deletion without failing the scan (ADR-0584).
  return {
    head,
    headSeq: observed?.seq ?? 0,
    candidates,
    reachable,
    lastReference,
    assignmentInputs,
    archiveInputs,
    archiveOwners,
    superseded,
  };
}

/** Candidates whose last naming record and own bytes both predate `before`. */
export function eligibleConvergenceArtifacts(
  files: readonly CasReferenceFile[],
  roots: Pick<CasRetentionRoots, "candidates">,
  before: number,
): string[] {
  return files.flatMap((file) =>
    file.hash !== null &&
    file.modifiedAt < before &&
    (roots.candidates.get(file.hash) ?? Infinity) < before
      ? [file.hash]
      : [],
  );
}

/**
 * When a collectable object was last named: a convergence candidate by its convergence events and
 * assignment input, a released record only by its superseded assignment's own events (ADR-0586).
 */
export function retentionNamedAt(
  roots: Pick<CasRetentionRoots, "candidates" | "superseded">,
  released: ReadonlyMap<string, ReleasedRecord>,
  hash: string,
): number {
  const named = roots.candidates.get(hash);
  if (!released.has(hash)) return named ?? Infinity;
  return Math.max(named ?? 0, roots.superseded.namedAt.get(hash) ?? 0);
}

/**
 * A reference held by any file other than an eligible candidate or released record is a root;
 * their references are edges. An eligible object that is neither any longer roots itself and its
 * references. An assignment archive never roots its own input (ADR-0585), and neither it nor its
 * assignment's events root that assignment's released records (ADR-0586).
 */
export function retentionReferenceGraph(
  files: readonly CasReferenceFile[],
  referencesOf: (file: CasReferenceFile) => readonly string[],
  roots: Pick<
    CasRetentionRoots,
    "reachable" | "candidates" | "archiveInputs" | "archiveOwners" | "superseded"
  >,
  eligible: ReadonlySet<string>,
  released: ReadonlyMap<string, ReleasedRecord>,
): { reachable: Set<string>; edges: Map<string, readonly string[]> } {
  const reachable = new Set(roots.reachable);
  const edges = new Map<string, readonly string[]>();
  const ownedBy = (hash: string, assignmentId: string | undefined) =>
    assignmentId !== undefined && released.get(hash)?.assignmentId === assignmentId;
  for (const [assignmentId, references] of roots.superseded.references)
    for (const hash of references) if (!ownedBy(hash, assignmentId)) reachable.add(hash);
  for (const file of files) {
    const references = referencesOf(file);
    if (file.hash !== null && eligible.has(file.hash)) {
      if (roots.candidates.has(file.hash) || released.has(file.hash)) {
        edges.set(file.hash, references);
        continue;
      }
      reachable.add(file.hash);
    }
    const input = file.hash === null ? undefined : roots.archiveInputs.get(file.hash);
    const owner = file.hash === null ? undefined : roots.archiveOwners.get(file.hash);
    for (const hash of references) if (hash !== input && !ownedBy(hash, owner)) reachable.add(hash);
  }
  return { reachable, edges };
}

export function reachableConvergenceArtifacts(
  roots: ReadonlySet<string>,
  edges: ReadonlyMap<string, readonly string[]>,
): Set<string> {
  const marked = new Set(roots);
  const pending = [...marked];
  while (pending.length) {
    for (const hash of edges.get(pending.pop()!) ?? []) {
      if (marked.has(hash)) continue;
      marked.add(hash);
      pending.push(hash);
    }
  }
  return marked;
}
