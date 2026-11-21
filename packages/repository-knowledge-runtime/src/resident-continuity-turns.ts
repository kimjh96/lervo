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
 * that read the Hub before it. A turn that met a busy worker lock while this resident's own cycle
 * runs sets no deadline and runs again when that cycle ends (`afterCycle`); one that met another
 * process's lock looks again with backoff from the retry bound. A held repository (ADR-0561)
 * runs no turn.
 */
export function residentContinuityTurns(input: {
  continuity: ConvergenceContinuity | undefined;
  signal: AbortSignal;
  held: () => Promise<boolean>;
  /** Whether this resident's own full cycle is running, so a busy lock is its own. */
  cycleRunning?: () => boolean;
  onDue: (at: number | null) => void;
  onFailure: (error: unknown) => void;
}): {
  run(options?: { force?: boolean }): Promise<void>;
  afterCycle(): void;
  settled(): Promise<void>;
} {
  let running: Promise<void> | null = null;
  let forceAgain = false;
  let afterCycle: { force: boolean } | null = null;
  let busyStreak = 0;
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
        const outcome = await continuity.turn({
          signal: input.signal,
          ...(options.force === true ? { force: true } : {}),
        });
        if (outcome.status !== "busy") {
          busyStreak = 0;
          input.onDue(continuityTurnDueAt(outcome.state, Date.now()));
        } else if (input.cycleRunning?.() === true) {
          afterCycle = { force: options.force === true || afterCycle?.force === true };
          input.onDue(null);
        } else {
          busyStreak = Math.min(busyStreak + 1, 16);
          input.onDue(
            Date.now() +
              Math.min(4 * 60 * 60_000, CONTINUITY_RETRY_MILLISECONDS * 2 ** (busyStreak - 1)),
          );
        }
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
    afterCycle: () => {
      if (afterCycle === null) return;
      const options = afterCycle;
      afterCycle = null;
      void run(options);
    },
    settled: async () => {
      while (running !== null) await running;
    },
  };
}
