// The gate of claims and the coordination stage (Lervo ADE coordination, "Delivery"). It belongs to
// the repository, not to a process: a served hook runs in the context server, whose environment is
// the resident's, so the start and every claim in a repository read the same switch.
import { lstat } from "node:fs/promises";
import { resolve } from "node:path";

import { resolveRepositoryCoordinationHome } from "@lervo/project-storage";

/**
 * Whether this release runs the coordination stage by default. Claims, the turn's reconciliation,
 * retiring, and the upgrade's sweep have landed and passed the real-repository canary, so every
 * repository coordinates unless its owner closes the gate. The writer must still select schema 16.
 */
export const COORDINATION_STAGE_ENABLED = true;

/** The file in the repository's coordination home whose presence closes the gate there. */
export const COORDINATION_GATE_FILE = "disabled";

/** `LERVO_COORDINATION=1` or `0` in this process, which tests use, or null to read the repository. */
export function coordinationStageOverride(environment: NodeJS.ProcessEnv): boolean | null {
  if (environment.LERVO_COORDINATION === "1") return true;
  if (environment.LERVO_COORDINATION === "0") return false;
  return null;
}

/**
 * Whether the gate is open for the repository: `LERVO_COORDINATION` in this process when set to
 * `1` or `0`; otherwise this release's switch, unless an owner-only regular file `disabled` sits
 * in the repository's coordination home, beside the claim path key. A file others can read or
 * write, or a link, closes nothing, and neither does a home that does not exist yet: the start
 * creates it, and a claim without a conversation record claims nothing.
 */
export async function coordinationGateOpen(
  repositoryRoot: string,
  environment: NodeJS.ProcessEnv = process.env,
): Promise<boolean> {
  const override = coordinationStageOverride(environment);
  if (override !== null) return override;
  if (!COORDINATION_STAGE_ENABLED) return false;
  try {
    const home = await resolveRepositoryCoordinationHome(repositoryRoot, { readOnly: true });
    const file = await lstat(resolve(home.root, COORDINATION_GATE_FILE));
    const ownerOnly =
      file.isFile() &&
      (process.platform === "win32" ||
        ((file.mode & 0o077) === 0 && file.uid === process.getuid?.()));
    return !ownerOnly;
  } catch {
    return true;
  }
}
