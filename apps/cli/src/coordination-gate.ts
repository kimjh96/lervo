// The gate of claims and the coordination stage (Lervo ADE coordination, "Delivery"). It belongs to
// the repository, not to a process: a served hook runs in the context server, whose environment is
// the resident's, so the start and every claim in a repository read the same switch.
import { lstat } from "node:fs/promises";
import { resolve } from "node:path";

import { resolveRepositoryCoordinationHome } from "@lervo/project-storage";

/**
 * Whether this release runs the coordination stage. Schema 16 also carries conversation notes, so
 * it may be activated before claims are complete: the stage stays closed until the claim handler
 * and the turn's reconciliation land (Lervo ADE coordination, slice 1), whatever the writer selects.
 */
export const COORDINATION_STAGE_ENABLED = false;

/** The file in the repository's coordination home whose presence opens the gate there. */
export const COORDINATION_GATE_FILE = "enabled";

/** This release's switch, or `LERVO_COORDINATION=1` in this process, for tests. */
export function coordinationStageEnabled(environment: NodeJS.ProcessEnv): boolean {
  return COORDINATION_STAGE_ENABLED || environment.LERVO_COORDINATION === "1";
}

/**
 * Whether the gate is open for the repository: this release's switch, `LERVO_COORDINATION=1` in
 * this process, or an owner-only regular file `enabled` in the repository's coordination home,
 * beside the claim path key, for canaries. A home that does not exist yet keeps the gate closed.
 */
export async function coordinationGateOpen(
  repositoryRoot: string,
  environment: NodeJS.ProcessEnv = process.env,
): Promise<boolean> {
  if (coordinationStageEnabled(environment)) return true;
  try {
    const home = await resolveRepositoryCoordinationHome(repositoryRoot, { readOnly: true });
    const file = await lstat(resolve(home.root, COORDINATION_GATE_FILE));
    return (
      file.isFile() &&
      (process.platform === "win32" ||
        ((file.mode & 0o077) === 0 && file.uid === process.getuid?.()))
    );
  } catch {
    return false;
  }
}
