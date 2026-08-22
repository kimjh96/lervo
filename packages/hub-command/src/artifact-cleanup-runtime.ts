import { HubCommandError } from "./errors.js";
import { cleanupHubCommandArtifacts, type HubCommandArtifactCleanupResult } from "./artifact-cleanup.js";
import type {
  HubCommandArtifactCleanupScheduleStore,
  HubCommandArtifactLifecycleRepository,
  HubCommandArtifactLifecycleStore,
} from "./types.js";

export interface HubCommandArtifactCleanupWaitPort {
  wait(delayMs: number, signal: AbortSignal): Promise<void>;
}

export type HubCommandArtifactCleanupLoopCycle =
  | { status: "completed"; result: HubCommandArtifactCleanupResult; nextCycleAt: string }
  | { status: "failed"; failureCode: "artifact_cleanup_cycle_failed"; nextCycleAt: string };

export interface HubCommandArtifactCleanupLoopResult {
  status: "stopped";
  claimedCycleCount: number;
  completedCycleCount: number;
  failedCycleCount: number;
  lastCycle: HubCommandArtifactCleanupLoopCycle | null;
}

export interface HubCommandArtifactCleanupLoopOptions {
  schedule: HubCommandArtifactCleanupScheduleStore;
  repository: HubCommandArtifactLifecycleRepository;
  artifacts: HubCommandArtifactLifecycleStore;
  workerId: string;
  signal: AbortSignal;
  now?: () => string;
  wait?: HubCommandArtifactCleanupWaitPort;
  leaseDurationMs?: number;
  cycleIntervalMs?: number;
  continuationDelayMs?: number;
  retryDelayMs?: number;
  orphanGraceMs?: number;
  limit?: number;
  maximumScannedObjects?: number;
  onCycle?: (cycle: HubCommandArtifactCleanupLoopCycle) => void | Promise<void>;
}

const systemWait: HubCommandArtifactCleanupWaitPort = {
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

function validDuration(value: number, minimum: number, maximum: number): boolean {
  return Number.isSafeInteger(value) && value >= minimum && value <= maximum;
}

function parseTime(value: string, label: string): number {
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds) || milliseconds < 0) {
    throw new HubCommandError("invalid_request", `${label}이 유효하지 않습니다.`);
  }
  return milliseconds;
}

function nextTimestamp(now: string, delayMs: number): string {
  return new Date(parseTime(now, "artifact cleanup runtime 시각") + delayMs).toISOString();
}

export async function runHubCommandArtifactCleanupLoop(
  options: HubCommandArtifactCleanupLoopOptions,
): Promise<HubCommandArtifactCleanupLoopResult> {
  const leaseDurationMs = options.leaseDurationMs ?? 5 * 60_000;
  const cycleIntervalMs = options.cycleIntervalMs ?? 60 * 60_000;
  const continuationDelayMs = options.continuationDelayMs ?? 1_000;
  const retryDelayMs = options.retryDelayMs ?? 60_000;
  if (
    !validDuration(leaseDurationMs, 1_000, 30 * 60_000) ||
    !validDuration(cycleIntervalMs, 60_000, 24 * 60 * 60_000) ||
    !validDuration(continuationDelayMs, 100, 60_000) ||
    !validDuration(retryDelayMs, 1_000, 60 * 60_000)
  ) throw new HubCommandError("invalid_request", "artifact cleanup runtime 간격이 유효하지 않습니다.");

  const now = options.now ?? (() => new Date().toISOString());
  const wait = options.wait ?? systemWait;
  let claimedCycleCount = 0;
  let completedCycleCount = 0;
  let failedCycleCount = 0;
  let lastCycle: HubCommandArtifactCleanupLoopCycle | null = null;

  while (!options.signal.aborted) {
    const claimedAt = now();
    parseTime(claimedAt, "artifact cleanup claimedAt");
    const claim = await options.schedule.claimArtifactCleanupCycle({
      workerId: options.workerId,
      claimedAt,
      leaseDurationMs,
    });
    if (claim.status === "waiting") {
      const delay = Math.max(0, parseTime(claim.nextAttemptAt, "artifact cleanup nextAttemptAt") -
        parseTime(now(), "artifact cleanup 현재 시각"));
      await wait.wait(delay, options.signal);
      continue;
    }

    claimedCycleCount += 1;
    try {
      const result = await cleanupHubCommandArtifacts({
        repository: options.repository,
        artifacts: options.artifacts,
        workerId: options.workerId,
        cleanedAt: claimedAt,
        now,
        leaseDurationMs: Math.min(leaseDurationMs, 5 * 60_000),
        ...(options.orphanGraceMs === undefined ? {} : { orphanGraceMs: options.orphanGraceMs }),
        ...(options.limit === undefined ? {} : { limit: options.limit }),
        ...(claim.inventoryCursor === null ? {} : { inventoryCursor: claim.inventoryCursor }),
        ...(options.maximumScannedObjects === undefined ? {} : {
          maximumScannedObjects: options.maximumScannedObjects,
        }),
      });
      const completedAt = now();
      const nextCycleAt = nextTimestamp(
        completedAt,
        result.continuationRecommended ? continuationDelayMs : cycleIntervalMs,
      );
      await options.schedule.completeArtifactCleanupCycle({
        workerId: options.workerId,
        leaseId: claim.leaseId,
        completedAt,
        nextCycleAt,
        inventoryCursor: result.nextInventoryCursor,
        claimedCount: result.claimedCount,
        deletedCount: result.deletedCount,
        alreadyMissingCount: result.alreadyMissingCount,
        purgedDeliveryCount: result.purgedDeliveryCount,
        orphanPurgedCount: result.orphanPurgedCount,
        failureCount: result.failureCount,
        continuationRecommended: result.continuationRecommended,
      });
      completedCycleCount += 1;
      lastCycle = { status: "completed", result: structuredClone(result), nextCycleAt };
    } catch {
      const failedAt = now();
      const nextCycleAt = nextTimestamp(failedAt, retryDelayMs);
      await options.schedule.failArtifactCleanupCycle({
        workerId: options.workerId,
        leaseId: claim.leaseId,
        failedAt,
        nextCycleAt,
        failureCode: "artifact_cleanup_cycle_failed",
      });
      failedCycleCount += 1;
      lastCycle = {
        status: "failed",
        failureCode: "artifact_cleanup_cycle_failed",
        nextCycleAt,
      };
    }
    await options.onCycle?.(structuredClone(lastCycle));
  }
  return {
    status: "stopped",
    claimedCycleCount,
    completedCycleCount,
    failedCycleCount,
    lastCycle,
  };
}
