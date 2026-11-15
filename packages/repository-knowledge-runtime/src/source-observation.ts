import type { ProjectStorage } from "@lervo/project-storage";

import { captureConvergenceSources, type ConvergenceSourceCapture } from "./source-capture.js";

/**
 * How convergence observes repository sources within one worker cycle.
 *
 * - `exact` always captures the repository. It fences effects, settlement and verification
 *   evidence, with no unrelated await between it and the guarded write.
 * - `current` guards decisions. It may answer with an earlier capture only when validation proves
 *   the repository unchanged. A wrong answer costs wasted work, never an effect: the next exact
 *   fence still refuses with `source_bytes_changed`.
 * - `noteChange` reports this process's own effect, so the next `current` captures again.
 */
export interface ConvergenceSourceObservation {
  exact(policyHash: string): ConvergenceSourceCapture;
  current(policyHash: string): ConvergenceSourceCapture;
  noteChange(): void;
}

/** Every observation is a complete capture: the behaviour of a context without a session. */
export function exactConvergenceSourceObservation(root: string): ConvergenceSourceObservation {
  return {
    exact: (policyHash) => captureConvergenceSources(root, policyHash),
    current: (policyHash) => captureConvergenceSources(root, policyHash),
    noteChange: () => {},
  };
}

export function convergenceSourceObservation(context: {
  storage: Pick<ProjectStorage, "paths">;
  sourceObservation?: ConvergenceSourceObservation;
}): ConvergenceSourceObservation {
  return (
    context.sourceObservation ??
    exactConvergenceSourceObservation(context.storage.paths.repositoryRoot)
  );
}
