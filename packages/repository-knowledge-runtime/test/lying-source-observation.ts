import { captureConvergenceSources, type ConvergenceSourceCapture } from "../src/source-capture.js";
import type { ConvergenceSourceObservation } from "../src/source-observation.js";

/** The `src/` frame that asked for a capture, named by file and line. */
function observationSite(): string {
  for (const frame of (new Error().stack ?? "").split("\n").slice(1)) {
    const match = /repository-knowledge-runtime\/src\/([\w-]+\.ts):(\d+)/u.exec(frame);
    if (match === null || match[1] === "source-observation.ts") continue;
    // The assertion helpers sit between every check and its caller; host methods name their own.
    if (/assertObservedSource|assertConvergenceSource|assertSource(Exact|Current)/u.test(frame))
      continue;
    if (
      match[1] === "host.ts" &&
      !/\.(assertSettlement|assertCurrent|prepareStage|runStage) /u.test(frame)
    )
      continue;
    return `${match[1]}:${match[2]}`;
  }
  return "unknown";
}

export interface LyingObservationTrace {
  /** Exact captures in call order, by the site that asked. */
  exactSites: string[];
  /** Distinct sites whose decision checks the session answered. */
  currentSites: string[];
  noteChanges: number;
}

/**
 * A session whose validation always answers "unchanged": `current` returns the last capture without
 * looking at the repository, so it never notices another writer. It honours `noteChange`, as the
 * session does for this process's own effects: the next answer is a capture taken after them, but
 * before `beforeCurrent` runs. `exact` stays a complete capture, so only exact fences can refuse.
 * `beforeExact` and `beforeCurrent` may mutate the repository.
 */
export function lyingSourceObservation(
  root: string,
  hooks: {
    beforeExact?(site: string, trace: LyingObservationTrace): void;
    beforeCurrent?(site: string, trace: LyingObservationTrace): void;
    onObservation?(kind: "exact" | "current" | "note_change", trace: LyingObservationTrace): void;
  } = {},
): ConvergenceSourceObservation & { trace: LyingObservationTrace; resync(): void } {
  const trace: LyingObservationTrace = { exactSites: [], currentSites: [], noteChanges: 0 };
  const last = new Map<string, ConvergenceSourceCapture>();
  const capture = (policyHash: string) => {
    const captured = captureConvergenceSources(root, policyHash);
    last.set(policyHash, captured);
    return captured;
  };
  return {
    trace,
    exact(policyHash) {
      hooks.onObservation?.("exact", trace);
      const site = observationSite();
      hooks.beforeExact?.(site, trace);
      trace.exactSites.push(site);
      return capture(policyHash);
    },
    current(policyHash) {
      hooks.onObservation?.("current", trace);
      const site = observationSite();
      if (!trace.currentSites.includes(site)) trace.currentSites.push(site);
      // The answer is fixed before the hook can edit, so even a first call or one right after
      // noteChange() answers with bytes the edit made stale.
      const answer = last.get(policyHash) ?? capture(policyHash);
      hooks.beforeCurrent?.(site, trace);
      return answer;
    },
    /** Forgets every answer, as a session would after an edit no exact fence reached. */
    resync() {
      last.clear();
    },
    noteChange() {
      hooks.onObservation?.("note_change", trace);
      trace.noteChanges += 1;
      last.clear();
    },
  };
}
