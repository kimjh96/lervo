import {
  runRemoteCommandReconnectCycle,
  type RemoteCommandReconnectCycleResult,
  type RemoteCommandReconnectWorkerOptions,
} from "./delivery-worker.js";
import { RemoteCommandRuntimeError } from "./errors.js";

export interface RemoteCommandPollingWaitPort {
  wait(delayMs: number, signal: AbortSignal): Promise<void>;
}

export interface RemoteCommandReconnectLoopOptions {
  worker: RemoteCommandReconnectWorkerOptions;
  signal: AbortSignal;
  idlePollIntervalMs?: number;
  wait?: RemoteCommandPollingWaitPort;
  nowMilliseconds?: () => number;
  onCycle?: (result: RemoteCommandReconnectCycleResult) => void | Promise<void>;
}

export interface RemoteCommandReconnectLoopResult {
  status: "stopped";
  cycleCount: number;
  lastCycle: RemoteCommandReconnectCycleResult | null;
}

const systemWait: RemoteCommandPollingWaitPort = {
  wait: (delayMs, signal) => new Promise<void>((resolve) => {
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

function retryDelay(result: RemoteCommandReconnectCycleResult, input: {
  idlePollIntervalMs: number;
  nowMilliseconds: () => number;
}): number {
  if (result.status === "processed") return 0;
  if (result.status === "idle") return input.idlePollIntervalMs;
  const at = Date.parse(result.nextAttemptAt);
  const now = input.nowMilliseconds();
  if (!Number.isFinite(at) || !Number.isFinite(now)) {
    throw new RemoteCommandRuntimeError(
      "invalid_runtime_configuration",
      "remote command polling 시각이 유효하지 않습니다.",
    );
  }
  return Math.max(0, at - now);
}

export async function runRemoteCommandReconnectLoop(
  options: RemoteCommandReconnectLoopOptions,
): Promise<RemoteCommandReconnectLoopResult> {
  const idlePollIntervalMs = options.idlePollIntervalMs ?? 2_000;
  if (
    !Number.isSafeInteger(idlePollIntervalMs) ||
    idlePollIntervalMs < 100 || idlePollIntervalMs > 60 * 60_000
  ) {
    throw new RemoteCommandRuntimeError(
      "invalid_runtime_configuration",
      "remote command idle poll 간격이 유효하지 않습니다.",
    );
  }
  const wait = options.wait ?? systemWait;
  const nowMilliseconds = options.nowMilliseconds ?? Date.now;
  let cycleCount = 0;
  let lastCycle: RemoteCommandReconnectCycleResult | null = null;
  while (!options.signal.aborted) {
    lastCycle = await runRemoteCommandReconnectCycle(options.worker);
    cycleCount += 1;
    await options.onCycle?.(structuredClone(lastCycle));
    if (options.signal.aborted) break;
    await wait.wait(retryDelay(lastCycle, { idlePollIntervalMs, nowMilliseconds }), options.signal);
  }
  return { status: "stopped", cycleCount, lastCycle };
}
