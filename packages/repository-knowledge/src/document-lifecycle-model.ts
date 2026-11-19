import type { RelationSuspectEvidence, RelationSuspectReason } from "./relation-web-suspects.js";

/**
 * ADR-0562 document lifecycle. Every document of the relation web has exactly one state:
 *
 * - `current`: Lervo assessed it at `assessedRevision` and nothing it names changed since.
 * - `suspect`: at least one reason is unresolved; `assessedRevision` stays at the last revision
 *   through which the document was known to match, so the reasons are recomputed from it.
 * - `refreshed`: the freshness provider path verified its current bytes (a `verified_no_change`
 *   assessment whose dependencies still match).
 * - `superseded`: its header `Status:` says `superseded`; it is a historical record.
 * - `partially_superseded`: another document supersedes a named part; the rest stays current.
 * - `archived`: another historical marker (archive scope, front matter, or banner).
 * - `retired`: a reviewed lineage record retired its path.
 */
export type DocumentLifecycleState =
  | "current"
  | "suspect"
  | "refreshed"
  | "superseded"
  | "partially_superseded"
  | "archived"
  | "retired";

export const documentLifecycleStates: readonly DocumentLifecycleState[] = [
  "current",
  "suspect",
  "refreshed",
  "superseded",
  "partially_superseded",
  "archived",
  "retired",
];

/**
 * Reasons beyond the relation web reverse lookup:
 *
 * - `cadence_due`: the cadence sweep has not assessed the document yet, or not within the period.
 * - `superseded_undeclared`: another document supersedes it in full, but its own header has no
 *   `superseded` status, so it still governs and ranks; the fix is a mechanical header edit.
 */
export type DocumentLifecycleReason =
  RelationSuspectReason | "cadence_due" | "superseded_undeclared";

/**
 * How a reason is settled:
 *
 * - `deterministic`: the change touched nothing the document names; no edit and no provider call.
 * - `mechanical`: a missing reverse header line (`Amended by`, `Superseded in part by`, or a
 *   superseded status); a deterministic edit, never a provider call.
 * - `provider`: the remainder, which becomes a freshness finding (ADR-0463, ADR-0561 Tier 0).
 * - `cadence`: the document has not been reached by the cadence sweep yet.
 */
export type DocumentLifecycleResolution = "deterministic" | "mechanical" | "provider" | "cadence";

export interface DocumentLifecycleEvidence extends Omit<RelationSuspectEvidence, "reason"> {
  reason: DocumentLifecycleReason;
  resolution: DocumentLifecycleResolution;
  /** For a resolved or provider `path_changed`, identifiers of the document found in the diff. */
  matchedNames?: string[];
}

export interface DocumentLifecycleEntry {
  path: string;
  state: DocumentLifecycleState;
  /** Unresolved reasons of a `suspect`; empty otherwise. */
  reasons: DocumentLifecycleEvidence[];
  /** The revision through which Lervo knows the document matches, or null when never assessed. */
  assessedRevision: string | null;
  /** The last revision that verified its bytes: its own last commit or a provider assessment. */
  verifiedRevision: string | null;
  /** Parts superseded by other documents, for `partially_superseded`. */
  supersededParts: string[];
}

/** Every document is reached by the cadence sweep within this many days. */
export const DOCUMENT_LIFECYCLE_CADENCE_DAYS = 14;
/** Lower bound of the daily sweep, so a small repository is still swept promptly. */
export const MINIMUM_DOCUMENT_LIFECYCLE_CADENCE_PER_DAY = 16;

/** Documents the cadence sweep assesses per day so that all are reached within the period. */
export function documentLifecycleCadencePerDay(documents: number): number {
  return Math.max(
    MINIMUM_DOCUMENT_LIFECYCLE_CADENCE_PER_DAY,
    Math.ceil(documents / DOCUMENT_LIFECYCLE_CADENCE_DAYS),
  );
}

/** Lifecycle counts for health and lint. */
export interface DocumentLifecycleSummary {
  states: Record<DocumentLifecycleState, number>;
  /** Unresolved suspects by what settles them; `unknown` could not be evaluated. */
  suspects: { mechanical: number; provider: number; cadence: number; unknown: number };
  /**
   * Documents the reverse lookup reached in this evaluation, by outcome: every reason settled
   * deterministically, only mechanical edits left, or at least one reason left to the provider.
   */
  resolution: { deterministic: number; mechanical: number; provider: number };
  cadence: {
    periodDays: number;
    perDay: number;
    /** Documents the sweep assessed on the current UTC day. */
    assessedToday: number;
    /** Documents never assessed, including those without committed history. */
    unassessed: number;
    /** Days until every unassessed document with committed history is reached at `perDay`. */
    remainingDays: number;
  };
}
