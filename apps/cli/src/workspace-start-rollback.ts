// What a failed `lervo workspace start` gives back: the worktree and branch its earlier stages
// created, and the failure that names the stage.
import { CommandFailure, errorCode } from "./command-error-output.js";
import type {
  WorkspacePlacement,
  WorkspaceStartPorts,
  WorkspaceStartStage,
} from "./workspace-start.js";

/** The start's failure: the stage that failed, its cause, and whether the rollback finished. */
export function stageFailure(
  stage: WorkspaceStartStage,
  error: unknown,
  rollback: Rollback,
): CommandFailure {
  const cause = errorCode(error);
  const detail = error instanceof Error ? error.message : String(error);
  const rolledBack = rollback.done;
  return new CommandFailure(
    "workspace_start_failed",
    `The ${stage} stage failed: ${detail}${rolledBack ? "" : " Rollback did not finish."}`,
    {
      stage,
      cause,
      rolledBack,
      ...(rollback.cause === undefined ? {} : { rollbackCause: rollback.cause }),
    },
  );
}

/** Whether removing what a failed start created finished, and why not when it did not. */
export interface Rollback {
  readonly done: boolean;
  readonly cause?: string;
}

/** How long a second removal waits, so a Git lock another process holds briefly can clear. */
const ROLLBACK_RETRY_MS = 250;

/**
 * Removes what the earlier stages created. A removal that fails is tried once more after a short
 * wait, since a Git lock that another process holds for a moment, such as a background index
 * refresh, fails the first one without leaving anything to keep.
 */
export async function undo(
  ports: WorkspaceStartPorts,
  placement: WorkspacePlacement,
): Promise<Rollback> {
  try {
    await ports.removeWorkspace(placement);
    return { done: true };
  } catch {
    await new Promise((resolve) => setTimeout(resolve, ROLLBACK_RETRY_MS));
    try {
      await ports.removeWorkspace(placement);
      return { done: true };
    } catch (error) {
      return { done: false, cause: errorCode(error) };
    }
  }
}
