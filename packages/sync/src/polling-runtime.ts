import { SyncWorkerError } from "./errors.js";
import { type OutboundSyncWorkerOptions, type SyncCycleResult } from "./types.js";
import { runOutboundSyncCycle } from "./worker.js";

export interface OutboundSyncPollingWaitPort {
  wait(delayMs: number, signal: AbortSignal): Promise<void>;
}

export interface OutboundSyncLoopOptions {
  worker: OutboundSyncWorkerOptions;
  signal: AbortSignal;
  idlePollIntervalMs?: number;
  wait?: OutboundSyncPollingWaitPort;
  waitForIdleChange?: (signal: AbortSignal) => Promise<void>;
  nowMilliseconds?: () => number;
  onCycle?: (result: SyncCycleResult) => void | Promise<void>;
}

export interface OutboundSyncLoopResult {
  status: "stopped";
  cycleCount: number;
  lastCycle: SyncCycleResult | null;
}

const systemWait: OutboundSyncPollingWaitPort = {
  wait: (delayMs, signal) =>
    new Promise<void>((resolve) => {
      if (signal.aborted) {
        resolve();
        return;
      }
      const timeout = setTimeout(finish, delayMs);
      signal.addEventListener("abort", finish, { once: true });
      function finish(): void {
        clearTimeout(timeout);
        signal.removeEventListener("abort", finish);
        resolve();
      }
    }),
};

function retryDelay(
  result: SyncCycleResult,
  input: {
    idlePollIntervalMs: number;
    nowMilliseconds: () => number;
  },
): number {
  if (result.status === "synchronized") return 0;
  if (result.status === "idle") return input.idlePollIntervalMs;
  const at = Date.parse(result.nextAttemptAt);
  const now = input.nowMilliseconds();
  if (!Number.isFinite(at) || !Number.isFinite(now)) {
    throw new SyncWorkerError(
      "invalid_worker_configuration",
      "The outbound synchronization polling time is invalid.",
    );
  }
  return Math.max(0, at - now);
}

export async function runOutboundSyncLoop(
  options: OutboundSyncLoopOptions,
): Promise<OutboundSyncLoopResult> {
  const idlePollIntervalMs = options.idlePollIntervalMs ?? 2_000;
  if (
    !Number.isSafeInteger(idlePollIntervalMs) ||
    idlePollIntervalMs < 100 ||
    idlePollIntervalMs > 60 * 60_000
  ) {
    throw new SyncWorkerError(
      "invalid_worker_configuration",
      "The outbound synchronization idle polling interval is invalid.",
    );
  }
  const wait = options.wait ?? systemWait;
  const nowMilliseconds = options.nowMilliseconds ?? Date.now;
  let cycleCount = 0;
  let lastCycle: SyncCycleResult | null = null;
  while (!options.signal.aborted) {
    lastCycle = await runOutboundSyncCycle(options.worker);
    cycleCount += 1;
    await options.onCycle?.(structuredClone(lastCycle));
    if (options.signal.aborted) break;
    if (lastCycle.status === "idle" && options.waitForIdleChange !== undefined) {
      await options.waitForIdleChange(options.signal);
    } else {
      await wait.wait(
        retryDelay(lastCycle, { idlePollIntervalMs, nowMilliseconds }),
        options.signal,
      );
    }
  }
  return { status: "stopped", cycleCount, lastCycle };
}
