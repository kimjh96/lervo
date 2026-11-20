import type { ConvergenceContinuityState } from "./continuity-state.js";

/**
 * ADR-0602: a turn that met a busy worker lock outside this resident's own cycle is offered
 * again after this bound, doubling. A reconciliation itself has no cadence: it runs when its
 * inputs or the Hub's `knowledge` token changed, or at its own next time-based deadline.
 */
export const CONTINUITY_RETRY_MILLISECONDS = 15 * 60_000;

export type ContinuityTurnOutcome =
  | { status: "reconciled" | "current"; state: ConvergenceContinuityState | null }
  | { status: "busy"; state: ConvergenceContinuityState | null };
