// The claim log's side of a reconciliation (Lervo ADE coordination, "Reconciliation"): a deferred
// claim, or an earlier reconciliation's conflict, resolves once its paths no longer conflict, and
// becomes `unresolved` when a final reconciliation still finds them conflicting. A conflict with no
// entry yet gets one, so the conversation's lines and sealing can find it.
import { ClaimLog, claimLogPath, type ClaimLogEntry } from "./claim-log.js";
import type { ReconciliationConflict } from "./conversation-reconciliation.js";

/** Every entry of a session since the log began. */
const SINCE_THE_START = "1970-01-01T00:00:00.000Z";

/**
 * A session's claims that a reconciliation settles: its deferrals, which wrote without a claim,
 * and the conflicts an earlier reconciliation recorded, which carry no tool use. A refusal of a
 * tool call stopped its write, so it stays as it is.
 */
export function pendingClaims(
  log: ClaimLog,
  providerSessionId: string,
  workspaceId: string,
): ClaimLogEntry[] {
  return [
    ...log.deferredSince(providerSessionId, SINCE_THE_START),
    ...log
      .refusedSince(providerSessionId, SINCE_THE_START)
      .filter((entry) => entry.toolUseId === null),
  ].filter((entry) => entry.workspaceId === workspaceId);
}

/** The session's pending claims, or none when the log does not exist or cannot be read. */
export function readPendingClaims(
  providerSessionId: string,
  workspaceId: string,
  path = claimLogPath(),
): ClaimLogEntry[] {
  let log: ClaimLog | null;
  try {
    log = ClaimLog.openExisting(path);
  } catch {
    return [];
  }
  if (log === null) return [];
  try {
    return pendingClaims(log, providerSessionId, workspaceId);
  } catch {
    return [];
  } finally {
    log.close();
  }
}

function overlaps(left: string, right: string): boolean {
  return left === right || left.startsWith(`${right}/`) || right.startsWith(`${left}/`);
}

export interface ClaimSettlement {
  readonly resolved: number;
  readonly unresolved: number;
  /** Conflicts that had no entry and now have one. */
  readonly recorded: number;
}

/**
 * Settles the session's pending claims against a reconciliation's conflicts. A `final`
 * reconciliation, at `Stop`'s second run or the session's exit, moves what still conflicts to
 * `unresolved`; an earlier one leaves it pending, since the agent may still return the path.
 */
export async function settleReconciledClaims(input: {
  readonly providerSessionId: string;
  readonly workspaceId: string;
  readonly conflicts: readonly ReconciliationConflict[];
  readonly final: boolean;
  readonly now: Date;
  readonly path?: string;
}): Promise<ClaimSettlement> {
  const path = input.path ?? claimLogPath();
  const log =
    input.conflicts.length === 0 ? ClaimLog.openExisting(path) : await ClaimLog.open(path);
  if (log === null) return { resolved: 0, unresolved: 0, recorded: 0 };
  try {
    const conflicted = input.conflicts.flatMap((conflict) => conflict.paths);
    const stillConflicts = (paths: readonly string[]) =>
      paths.some((path) => conflicted.some((other) => overlaps(path, other)));
    let resolved = 0;
    let unresolved = 0;
    const pending = pendingClaims(log, input.providerSessionId, input.workspaceId);
    for (const entry of pending)
      if (!stillConflicts(entry.paths)) {
        if (log.updateState(entry.claimId, "resolved", input.now)) resolved += 1;
      } else if (input.final && log.updateState(entry.claimId, "unresolved", input.now))
        unresolved += 1;
    let recorded = 0;
    for (const conflict of input.conflicts) {
      const paths = conflict.paths.filter(
        (path) => !pending.some((entry) => entry.paths.some((other) => overlaps(path, other))),
      );
      if (paths.length === 0) continue;
      const entry = log.record(
        {
          workspaceId: input.workspaceId,
          sessionId: input.providerSessionId,
          toolUseId: null,
          decision: "deny",
          code: conflict.code,
          paths,
          holder:
            conflict.holder === null
              ? null
              : { agentId: conflict.holder.agentId, workspaceId: conflict.holder.workspaceId },
        },
        input.now,
      );
      recorded += 1;
      if (input.final && log.updateState(entry.claimId, "unresolved", input.now)) unresolved += 1;
    }
    return { resolved, unresolved, recorded };
  } finally {
    log.close();
  }
}
