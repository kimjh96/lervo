import { CommandFailure, errorCode } from "./command-error-output.js";
import type { HostFollowCycleResult } from "./host-follow-cycle.js";
import { followPollDelay } from "./host-follow-policy.js";
import { withHostProcessLock } from "./host-process-lock.js";
import type { HostUpgradeLayout } from "./host-upgrade-layout.js";

/**
 * ADR-0575 handover: the follower exits with this code after the `lervo` link moved to another
 * CLI. The service restarts only a failed exit (`Restart=on-failure`, launchd `KeepAlive` without
 * `SuccessfulExit`), so the code is non-zero; it is EX_TEMPFAIL, "try again".
 */
export const HOST_FOLLOW_HANDOVER_EXIT_CODE = 75;

/** One follower per host: a second one, service or `--once`, fails with `host_follow_in_progress`. */
export function withFollowLock<T>(
  layout: HostUpgradeLayout,
  operation: () => Promise<T>,
): Promise<T> {
  return withHostProcessLock(
    {
      path: layout.follow.lockPath,
      busy: (holder) =>
        new CommandFailure(
          "host_follow_in_progress",
          holder === null
            ? "Another follower took the lock first; nothing was changed."
            : `Another follower (process ${holder}) runs on this host; nothing was changed. If no Lervo process ${holder} exists, remove ${layout.follow.lockPath}.`,
          holder === null ? {} : { pid: holder, lock: layout.follow.lockPath },
        ),
    },
    operation,
  );
}

export interface HostFollowLoopDependencies {
  layout: HostUpgradeLayout;
  runCycle: () => Promise<HostFollowCycleResult>;
  random: () => number;
  /** Resolves after `milliseconds`, or as soon as `signal` aborts. */
  sleep: (milliseconds: number, signal: AbortSignal) => Promise<void>;
  /** One line per cycle; the service manager keeps it in the journal or the launchd log. */
  log: (line: string) => void;
  now: () => Date;
  /** Aborted when the service manager stops the follower. */
  signal: AbortSignal;
}

export function abortableSleep(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolvePromise) => {
    if (signal.aborted) {
      resolvePromise();
      return;
    }
    const timer = setTimeout(done, milliseconds);
    function done() {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolvePromise();
    }
    signal.addEventListener("abort", done, { once: true });
  });
}

/**
 * The long-running follower: one cycle, then a jittered sleep, until the service manager stops it
 * (exit 0) or the link moved to another CLI (handover exit). The stop signal also reaches the cycle,
 * which stops its running `lervo upgrade`, keeps its intent, and settles nothing. A cycle that
 * throws is logged and backs off, so a damaged file never turns into a busy loop.
 */
export async function runFollowLoop(dependencies: HostFollowLoopDependencies): Promise<number> {
  return withFollowLock(dependencies.layout, async () => {
    let failedCycles = 0;
    while (!dependencies.signal.aborted) {
      let backoff = 0;
      try {
        const result = await dependencies.runCycle();
        failedCycles = 0;
        backoff = result.backoff;
        dependencies.log(
          JSON.stringify({
            at: dependencies.now().toISOString(),
            outcome: result.outcome,
            tag: result.tag,
            code: result.code,
            activationId: result.activationId,
            repositories: result.pass?.repositories.length ?? null,
            ...(result.precededBy === null ? {} : { precededBy: result.precededBy }),
          }),
        );
        if (result.handover) return HOST_FOLLOW_HANDOVER_EXIT_CODE;
      } catch (error) {
        failedCycles += 1;
        dependencies.log(
          JSON.stringify({
            at: dependencies.now().toISOString(),
            outcome: "cycle_failed",
            code: errorCode(error),
          }),
        );
      }
      await dependencies.sleep(
        followPollDelay(Math.max(backoff, failedCycles), dependencies.random),
        dependencies.signal,
      );
    }
    return 0;
  });
}
