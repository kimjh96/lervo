// ADR-0660: one retention slice under this host's retention turn. The full worker cycle and the
// resident's retention-only wake both run retention through here, so the host-wide pace holds
// whichever of them asks.
import type { ProjectStorage } from "@lervo/project-storage";

import { runCasRetentionPass, type CasRetentionPassOutcome } from "./cas-retention.js";
import { finishRetentionTurn, requestRetentionTurn } from "./cas-retention-host-turns.js";
import type { CasRetentionObservation } from "./cas-retention-observation.js";

export interface CasRetentionSlice {
  /** `busy`: another process held the repository's worker lock. */
  outcome: CasRetentionPassOutcome | "busy";
  observation: CasRetentionObservation | null;
  /** With `deferred`: when the host's next turn can start. */
  retryAt: number | null;
}

export async function runCasRetentionSlice(input: {
  storage: ProjectStorage;
  /** The host admission directory, which also holds the retention turns. */
  directory: string;
  shouldYield: () => Promise<boolean>;
}): Promise<CasRetentionSlice> {
  const repositoryRoot = input.storage.paths.repositoryRoot;
  let granted = false;
  let retryAt: number | null = null;
  const admit = async () => {
    const now = Date.now();
    const turn = await requestRetentionTurn({
      directory: input.directory,
      repositoryRoot,
      pendingSince: now,
      now,
    });
    if (turn.granted) granted = true;
    else retryAt = turn.retryAt;
    return turn.granted;
  };
  let pass: Awaited<ReturnType<typeof runCasRetentionPass>> = null;
  try {
    pass = await runCasRetentionPass(input.storage, input.shouldYield, admit);
  } finally {
    // A turn that fails to finish keeps its start as the host's last slice, so the pause holds.
    if (granted)
      await finishRetentionTurn({
        directory: input.directory,
        repositoryRoot,
        finishedAt: Date.now(),
        remaining: pass?.observation.remaining === true,
      }).catch(() => undefined);
  }
  return pass === null
    ? { outcome: "busy", observation: null, retryAt: null }
    : { ...pass, retryAt };
}
