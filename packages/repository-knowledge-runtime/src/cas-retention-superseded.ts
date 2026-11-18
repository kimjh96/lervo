import type { EventEnvelope } from "@lervo/schemas";
import { CasRetentionBoundError } from "./cas-retention-errors.js";
import type { ConvergenceAssignmentInput } from "./cas-retention-assignment-inputs.js";

const HASH = /^sha256:[a-f0-9]{64}$/u;

/** A convergence assignment of a settled obligation outside its latest settled stage (ADR-0586). */
export interface SupersededAssignment {
  obligationId: string;
  /** Bare digest of the assignment's `convergenceInputArtifactHash`. */
  input: string;
}

export interface SupersededLifecycle {
  assignments: Map<string, SupersededAssignment>;
  /** Bare digest named by exactly one superseded assignment's `assignment.completed`, to it. */
  completions: Map<string, string>;
  /**
   * Everything a superseded assignment's own events name. These stay roots, except the records
   * that classification proves belong to that same assignment.
   */
  references: Map<string, string[]>;
  /** Latest event time at which a superseded assignment's own event names each reference. */
  namedAt: Map<string, number>;
}

/** What the obligation replay knows when the snapshot ends. */
export interface ObligationStageState {
  settled: boolean;
  /** References of the latest stage record whose state is neither `queued` nor `running`. */
  latest: string[];
  /** That record's `assignmentId`, if any. */
  latestAssignment: string | null;
}

/**
 * Collects the events of convergence assignments while the snapshot replays. Supersession is known
 * only at the end, so their references wait until `finish`, which roots every reference of an
 * assignment that is not superseded.
 */
export function trackSupersededLifecycle(maximumReferences: number) {
  const created = new Map<
    string,
    { obligationId: string; input: string; namedAfterSettlement: boolean }
  >();
  const deferred = new Map<string, Set<string>>();
  const namedAt = new Map<string, number>();
  // `null` marks a hash that two assignments' completions name: it has no single owner.
  const completions = new Map<string, string | null>();
  let deferredReferences = 0;
  return {
    created(input: ConvergenceAssignmentInput, settled: boolean): void {
      created.set(input.assignmentId, {
        obligationId: input.obligationId,
        input: input.hash,
        namedAfterSettlement: settled,
      });
    },
    /** True when the event belongs to a known convergence assignment and must not root yet. */
    defer(event: EventEnvelope, references: readonly string[]): boolean {
      const id = event.payload.assignmentId;
      if (typeof id !== "string" || !created.has(id)) return false;
      const at = Date.parse(event.occurredAt);
      if (!Number.isFinite(at))
        throw new Error("Convergence assignment retention time is invalid.");
      let owned = deferred.get(id);
      if (owned === undefined) deferred.set(id, (owned = new Set()));
      for (const hash of references) {
        if (!owned.has(hash)) deferredReferences++;
        owned.add(hash);
        namedAt.set(hash, Math.max(namedAt.get(hash) ?? 0, at));
      }
      if (deferredReferences > maximumReferences)
        throw new CasRetentionBoundError("CAS assignment reference inventory exceeds its bound.");
      const named = event.payload.artifactHashes;
      if (event.type === "assignment.completed" && Array.isArray(named))
        for (const value of named) {
          if (typeof value !== "string" || !HASH.test(value)) continue;
          const owner = completions.get(value.slice(7));
          completions.set(value.slice(7), owner === undefined || owner === id ? id : null);
        }
      return true;
    },
    finish(
      obligations: ReadonlyMap<string, ObligationStageState>,
      root: (hash: string) => void,
    ): SupersededLifecycle {
      const assignments = new Map<string, SupersededAssignment>();
      for (const [id, assignment] of created) {
        const row = obligations.get(assignment.obligationId);
        if (
          row?.settled === true &&
          !assignment.namedAfterSettlement &&
          row.latestAssignment !== id &&
          !row.latest.includes(assignment.input)
        )
          assignments.set(id, { obligationId: assignment.obligationId, input: assignment.input });
      }
      const references = new Map<string, string[]>();
      const supersededNamedAt = new Map<string, number>();
      for (const [id, owned] of deferred) {
        if (!assignments.has(id)) {
          for (const hash of owned) root(hash);
          continue;
        }
        references.set(id, [...owned]);
        for (const hash of owned) supersededNamedAt.set(hash, namedAt.get(hash)!);
      }
      const owners = new Map<string, string>();
      for (const [hash, owner] of completions)
        if (owner !== null && assignments.has(owner)) owners.set(hash, owner);
      return { assignments, completions: owners, references, namedAt: supersededNamedAt };
    },
  };
}
