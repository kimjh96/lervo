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
  const obligations = new Map<string, { settled: boolean; latest: string[]; all: string[] }>();
  const assignments = new Map<string, ConvergenceAssignmentInput>();
  const assignmentInputs = new Set<string>();
  const assignmentNamedAt = new Map<string, number>();
  const archiveInputs = new Map<string, string>();
  let parked: string[] = [];
  const obligation = (id: string) => {
    let row = obligations.get(id);
    if (!row) {
      row = { settled: false, latest: [], all: [] };
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
      if (input.otherReferences.includes(input.hash)) return;
      assignmentInputs.add(input.hash);
      const row = obligation(input.obligationId);
      // An input named after its obligation settled has no stage lifecycle left: keep it.
      if (row.settled) reachable.add(input.hash);
      else row.all.push(input.hash);
      return;
    }
    if (!CONVERGENCE.has(event.type)) {
      const archived = archivedAssignmentInput(event, assignments);
      if (archived !== null) archiveInputs.set(archived.archiveHash, archived.inputHash);
      root();
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
      if (event.payload.state !== "queued" && event.payload.state !== "running") row.latest = refs;
      // These proofs are historical consumers, not disposable stage diagnostics.
      if (event.payload.stage === "normalization_apply" && event.payload.state === "current")
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
 * A reference held by any file other than an eligible candidate is a root; a candidate's
 * references are edges. An assignment archive never roots its own input (ADR-0585).
 */
export function retentionReferenceGraph(
  files: readonly CasReferenceFile[],
  referencesOf: (file: CasReferenceFile) => readonly string[],
  roots: Pick<CasRetentionRoots, "reachable" | "archiveInputs">,
  eligible: ReadonlySet<string>,
): { reachable: Set<string>; edges: Map<string, readonly string[]> } {
  const reachable = new Set(roots.reachable);
  const edges = new Map<string, readonly string[]>();
  for (const file of files) {
    const references = referencesOf(file);
    if (file.hash !== null && eligible.has(file.hash)) {
      edges.set(file.hash, references);
      continue;
    }
    const input = file.hash === null ? undefined : roots.archiveInputs.get(file.hash);
    for (const hash of references) if (hash !== input) reachable.add(hash);
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
