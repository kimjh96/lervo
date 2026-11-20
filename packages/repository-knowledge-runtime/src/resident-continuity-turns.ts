import {
  CONTINUITY_RETRY_MILLISECONDS,
  type ConvergenceContinuity,
} from "./convergence-continuity.js";

/**
 * When continuity looks again after a turn: its own next reconciliation, never sooner than a
 * second, or the retry bound when it reported none it could keep (no state after a busy lock, or
 * an unreadable moment). A state with no time-based input left has no deadline (ADR-0602).
 */
export function continuityTurnDueAt(
  state: { nextReconcileAt: string | null } | null,
  now: number,
): number | null {
  if (state === null) return now + CONTINUITY_RETRY_MILLISECONDS;
  if (state.nextReconcileAt === null) return null;
  const at = Date.parse(state.nextReconcileAt);
  return Number.isFinite(at) ? Math.max(now + 1_000, at) : now + CONTINUITY_RETRY_MILLISECONDS;
}

/**
 * ADR-0470 continuity turns for one resident, one at a time. ADR-0602: each turn reports
 * continuity's own next reconciliation as the resident's deadline (continuityTurnDueAt). A forced
 * turn asked for while one runs runs again after it, so a Hub change is never folded into a turn
 * that read the Hub before it. A held repository (ADR-0561) runs no turn.
 */
export function residentContinuityTurns(input: {
  continuity: ConvergenceContinuity | undefined;
  signal: AbortSignal;
  held: () => Promise<boolean>;
  onDue: (at: number | null) => void;
  onFailure: (error: unknown) => void;
}): { run(options?: { force?: boolean }): Promise<void>; settled(): Promise<void> } {
  let running: Promise<void> | null = null;
  let forceAgain = false;
  const run = (options: { force?: boolean } = {}): Promise<void> => {
    const continuity = input.continuity;
    if (continuity === undefined || input.signal.aborted) return Promise.resolve();
    if (running !== null) {
      if (options.force === true) forceAgain = true;
      return running;
    }
    running = input
      .held()
      .then(async (held) => {
        if (held) return;
        const state = await continuity.reconcile({
          signal: input.signal,
          ...(options.force === true ? { force: true } : {}),
        });
        input.onDue(continuityTurnDueAt(state, Date.now()));
      })
      .then(
        () => undefined,
        (error: unknown) => {
          if (!input.signal.aborted) input.onFailure(error);
        },
      )
      .finally(() => {
        running = null;
      })
      .then(() => {
        if (!forceAgain) return;
        forceAgain = false;
        return run({ force: true });
      });
    return running;
  };
  return {
    run,
    settled: async () => {
      while (running !== null) await running;
    },
  };
}
