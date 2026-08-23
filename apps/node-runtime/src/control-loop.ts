import {
  type RemoteCommandReconnectCycleResult,
  type RemoteCommandPollingWaitPort,
} from "@lervo/remote-command";
import { type runPolicySyncCycle } from "@lervo/policy";

import { NodeRuntimeError } from "./errors.js";

export type PolicySyncCycleResult = Awaited<ReturnType<typeof runPolicySyncCycle>>;

export type RemoteControlCycleResult =
  | {
      status: "policy_unavailable";
      policy: Extract<PolicySyncCycleResult, { status: "offline" }>;
    }
  | {
      status: "command_checked";
      policy: Exclude<PolicySyncCycleResult, { status: "offline" }>;
      command: RemoteCommandReconnectCycleResult;
    };

export interface RemoteControlLoopResult {
  status: "stopped";
  cycleCount: number;
  lastCycle: RemoteControlCycleResult | null;
}

export interface RemoteControlLoopOptions {
  signal: AbortSignal;
  runPolicyCycle(): Promise<PolicySyncCycleResult>;
  runCommandCycle(): Promise<RemoteCommandReconnectCycleResult>;
  idlePollIntervalMs?: number;
  retryDelayMs?: number;
  wait?: RemoteCommandPollingWaitPort;
  nowMilliseconds?: () => number;
  onCycle?: (result: RemoteControlCycleResult) => void | Promise<void>;
}

const systemWait: RemoteCommandPollingWaitPort = {
  wait: (delayMs, signal) => new Promise<void>((resolve) => {
    if (signal.aborted) return resolve();
    const timeout = setTimeout(finish, delayMs);
    signal.addEventListener("abort", finish, { once: true });
    function finish(): void {
      clearTimeout(timeout);
      signal.removeEventListener("abort", finish);
      resolve();
    }
  }),
};

function checkedInteger(value: number | undefined, fallback: number, minimum: number): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved < minimum || resolved > 60 * 60_000) {
    throw new NodeRuntimeError("invalid_config", "The remote-control polling interval is invalid.");
  }
  return resolved;
}

function commandDelay(
  result: RemoteCommandReconnectCycleResult,
  idlePollIntervalMs: number,
  nowMilliseconds: () => number,
): number {
  if (result.status === "processed") return 0;
  if (result.status === "idle") return idlePollIntervalMs;
  const next = Date.parse(result.nextAttemptAt);
  const now = nowMilliseconds();
  if (!Number.isFinite(next) || !Number.isFinite(now)) {
    throw new NodeRuntimeError("startup_failed", "The remote-control polling time is invalid.");
  }
  return Math.max(0, next - now);
}

export async function runRemoteControlLoop(
  options: RemoteControlLoopOptions,
): Promise<RemoteControlLoopResult> {
  const idlePollIntervalMs = checkedInteger(options.idlePollIntervalMs, 2_000, 100);
  const retryDelayMs = checkedInteger(options.retryDelayMs, 5_000, 1_000);
  const wait = options.wait ?? systemWait;
  const nowMilliseconds = options.nowMilliseconds ?? Date.now;
  let cycleCount = 0;
  let lastCycle: RemoteControlCycleResult | null = null;
  while (!options.signal.aborted) {
    const policy = await options.runPolicyCycle();
    if (options.signal.aborted) break;
    if (policy.status === "offline") {
      lastCycle = { status: "policy_unavailable", policy };
    } else {
      lastCycle = {
        status: "command_checked",
        policy,
        command: await options.runCommandCycle(),
      };
    }
    cycleCount += 1;
    await options.onCycle?.(structuredClone(lastCycle));
    if (options.signal.aborted) break;
    const delay = lastCycle.status === "policy_unavailable"
      ? retryDelayMs
      : commandDelay(lastCycle.command, idlePollIntervalMs, nowMilliseconds);
    await wait.wait(delay, options.signal);
  }
  return { status: "stopped", cycleCount, lastCycle };
}
