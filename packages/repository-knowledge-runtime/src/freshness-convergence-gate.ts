import type { KnowledgeConvergenceStatus } from "@lervo/repository-knowledge";

/**
 * Convergence states in which no stage is about to run on the current snapshot: nothing is
 * outstanding, or the obligation is parked until an external change or decision. A freshness
 * commit moves HEAD like a developer commit, so it runs only here and never between an ADR-0465
 * batch-boundary commit and the stage it re-queued under the `committedHead` fence.
 */
const PARKED_STATES: ReadonlySet<KnowledgeConvergenceStatus["state"]> = new Set([
  "idle",
  "current",
  "waiting_authority",
  "attention_required",
]);

export function documentFreshnessMayRun(
  convergence: Pick<KnowledgeConvergenceStatus, "state">,
): boolean {
  return PARKED_STATES.has(convergence.state);
}
