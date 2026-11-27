// The claim log's side of a reconciliation (Lervo ADE coordination, "Reconciliation"): a deferred
// claim, an earlier reconciliation's conflict, or an unresolved path resolves once its paths no
// longer conflict, and becomes `unresolved` when a final reconciliation still finds them
// conflicting. A conflict the log does not hold yet gets one entry, and only such a new conflict
// blocks a `Stop`, so a conflict that persists blocks once, not every turn.
import { ClaimLog, claimLogPath, type ClaimLogEntry } from "./claim-log.js";
import type { ReconciliationConflict } from "./conversation-reconciliation.js";

/** Every entry of a session since the log began. */
const SINCE_THE_START = "1970-01-01T00:00:00.000Z";

/**
 * The claims a reconciliation settles: the session's deferrals, which wrote without a claim, the
 * conflicts an earlier reconciliation recorded for it, which carry no tool use, and every
 * unresolved entry of the conversation. A refusal of a tool call stopped its write, so it stays.
 */
export function pendingClaims(
  log: ClaimLog,
  providerSessionId: string,
  workspaceId: string,
): ClaimLogEntry[] {
  const entries = [
    ...log.deferredSince(providerSessionId, SINCE_THE_START),
    ...log
      .refusedSince(providerSessionId, SINCE_THE_START)
      .filter((entry) => entry.toolUseId === null),
  ].filter((entry) => entry.workspaceId === workspaceId);
  const seen = new Set(entries.map((entry) => entry.claimId));
  return [...entries, ...log.unresolvedOf(workspaceId).filter((entry) => !seen.has(entry.claimId))];
}

/** The pending claims, or none when the log does not exist or cannot be read. */
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

/** Whether a pending refusal already holds `path` against the same holder. */
function alreadyRefused(
  pending: readonly ClaimLogEntry[],
  conflict: ReconciliationConflict,
  path: string,
): boolean {
  const holder = conflict.holder?.agentId ?? null;
  return pending.some(
    (entry) =>
      entry.decision === "deny" &&
      (entry.holder?.agentId ?? null) === holder &&
      entry.paths.some((other) => overlaps(path, other)),
  );
}

export interface ClaimSettlement {
  readonly resolved: number;
  readonly unresolved: number;
  /** Conflicts, or parts of them, that the log did not hold yet and now does. */
  readonly newConflicts: readonly ReconciliationConflict[];
}

/**
 * Settles the pending claims against a reconciliation's conflicts. Call it only for a
 * reconciliation that judged every changed path. A `final` reconciliation, at `Stop`'s second run
 * or the session's exit, moves what still conflicts to `unresolved`; an earlier one leaves it
 * pending, since the agent may still return the path.
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
  if (log === null) return { resolved: 0, unresolved: 0, newConflicts: [] };
  try {
    const conflicted = input.conflicts.flatMap((conflict) => conflict.paths);
    const pending = pendingClaims(log, input.providerSessionId, input.workspaceId);
    let resolved = 0;
    let unresolved = 0;
    for (const entry of pending)
      if (!entry.paths.some((path) => conflicted.some((other) => overlaps(path, other)))) {
        if (log.updateState(entry.claimId, "resolved", input.now)) resolved += 1;
      } else if (input.final && entry.state !== "unresolved") {
        if (log.updateState(entry.claimId, "unresolved", input.now)) unresolved += 1;
      }
    const newConflicts: ReconciliationConflict[] = [];
    for (const conflict of input.conflicts) {
      const paths = conflict.paths.filter((path) => !alreadyRefused(pending, conflict, path));
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
      newConflicts.push({ ...conflict, paths });
      if (input.final && log.updateState(entry.claimId, "unresolved", input.now)) unresolved += 1;
    }
    return { resolved, unresolved, newConflicts };
  } finally {
    log.close();
  }
}
