// ADR-0660: one retention slice under this host's retention turn. The full worker cycle and the
// resident's retention-only wake both run retention through here, so the host-wide pace holds
// whichever of them asks.
import type { ProjectStorage } from "@lervo/project-storage";

import { runCasRetentionPass, type CasRetentionPassOutcome } from "./cas-retention.js";
import {
  finishRetentionTurn,
  requestRetentionTurn,
  returnRetentionTurn,
} from "./cas-retention-host-turns.js";
import type { CasRetentionObservation } from "./cas-retention-observation.js";
import { recordRetentionWait } from "./cas-retention-wait.js";

export interface CasRetentionSlice {
  /** `busy`: another process held the repository's worker lock. */
  outcome: CasRetentionPassOutcome | "busy";
  observation: CasRetentionObservation | null;
  /** With `deferred`: when the host's turn is expected; the request holds its place then. */
  retryAt: number | null;
}

export async function runCasRetentionSlice(input: {
  storage: ProjectStorage;
  /** The host admission directory, which also holds the retention turns. */
  directory: string;
  shouldYield: () => Promise<boolean>;
  /** A turn the caller was already granted; absent, the pass asks once work is due. */
  turn?: { previousSliceAt: number };
}): Promise<CasRetentionSlice> {
  const repositoryRoot = input.storage.paths.repositoryRoot;
  const turnInput = { directory: input.directory, repositoryRoot };
  let turn = input.turn ?? null;
  let retryAt: number | null = null;
  const admit = async () => {
    if (turn !== null) return true;
    const answer = await requestRetentionTurn({ ...turnInput, now: Date.now() });
    if (answer.granted) turn = answer;
    else retryAt = answer.retryAt;
    return answer.granted;
  };
  let pass: Awaited<ReturnType<typeof runCasRetentionPass>> = null;
  try {
    pass = await runCasRetentionPass(input.storage, input.shouldYield, admit);
  } finally {
    // A turn that fails to finish keeps its start as the host's last slice, so the pause holds.
    const granted: { previousSliceAt: number } | null = turn;
    if (granted !== null)
      await (
        pass?.outcome === "ran"
          ? finishRetentionTurn({
              ...turnInput,
              finishedAt: Date.now(),
              remaining: pass.observation.remaining === true,
            })
          : returnRetentionTurn({ ...turnInput, previousSliceAt: granted.previousSliceAt })
      ).catch(() => undefined);
  }
  if (pass === null) return { outcome: "busy", observation: null, retryAt: null };
  // A deferred turn is recorded with its moment, whichever path asked; a slice that ran clears it.
  const deferredUntil: number | null = retryAt;
  const knowledgeState = input.storage.paths.knowledgeState;
  if (pass.outcome === "ran") await recordRetentionWait(knowledgeState, null, Date.now());
  if (pass.outcome === "deferred" && deferredUntil !== null)
    await recordRetentionWait(knowledgeState, "retention_turn", Date.now(), deferredUntil);
  return { ...pass, retryAt };
}
