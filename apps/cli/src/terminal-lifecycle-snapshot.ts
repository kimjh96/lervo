// The repository snapshot a lifecycle inspection captured, kept beside its result. Its own module,
// with no imports of its own, so the Stop's change recording can read it without importing the
// inspection, whose dependencies import that recording back.
import type { RepositorySnapshot } from "@lervo/orchestrator";

import type { TerminalLifecycleInspection } from "./terminal-hook-contract.js";

/**
 * The repository snapshot each inspection captured, kept beside its result rather than in it: the
 * result is printed as JSON, and the snapshot holds every file hash. A Stop records the turn's
 * change from it instead of walking the repository a second time.
 */
const capturedSnapshots = new WeakMap<
  TerminalLifecycleInspection,
  { root: string; snapshot: RepositorySnapshot }
>();

/** Records the snapshot `inspection` captured of `root`. */
export function rememberLifecycleRepositorySnapshot(
  inspection: TerminalLifecycleInspection,
  root: string,
  snapshot: RepositorySnapshot,
): TerminalLifecycleInspection {
  capturedSnapshots.set(inspection, { root, snapshot });
  return inspection;
}

/** The snapshot `inspection` captured of `root`, or undefined for another root. */
export function lifecycleRepositorySnapshot(
  inspection: TerminalLifecycleInspection,
  root: string,
): RepositorySnapshot | undefined {
  const captured = capturedSnapshots.get(inspection);
  return captured?.root === root ? captured.snapshot : undefined;
}
