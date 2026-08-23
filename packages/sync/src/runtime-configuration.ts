import { SyncWorkerError } from "./errors.js";
import { type OutboundSyncWorkerOptions, type SyncClock } from "./types.js";

const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u;

export interface ResolvedSyncWorkerConfiguration {
  clock: SyncClock;
  leaseDurationMs: number;
  retryDelayMs: number;
  batchLimit: number;
}

function assertPositiveInteger(value: number, name: string, maximum: number): void {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new SyncWorkerError(
      "invalid_worker_configuration",
      `${name} is outside the allowed range.`,
    );
  }
}

export function resolveWorkerConfiguration(
  options: OutboundSyncWorkerOptions,
): ResolvedSyncWorkerConfiguration {
  const configuration = {
    clock: options.clock ?? { now: () => new Date().toISOString() },
    leaseDurationMs: options.leaseDurationMs ?? 30_000,
    retryDelayMs: options.retryDelayMs ?? 5_000,
    batchLimit: options.batchLimit ?? 100,
  };
  assertPositiveInteger(configuration.leaseDurationMs, "leaseDurationMs", 86_400_000);
  assertPositiveInteger(configuration.retryDelayMs, "retryDelayMs", 86_400_000);
  assertPositiveInteger(configuration.batchLimit, "batchLimit", 100);
  if (
    options.workerId.length < 1 ||
    options.workerId.length > 128 ||
    !SHA256_PATTERN.test(options.expectedPeerIdentityHash)
  ) {
    throw new SyncWorkerError(
      "invalid_worker_configuration",
      "The worker ID or Hub peer identity configuration is invalid.",
    );
  }
  return configuration;
}

export function clockTimestamp(clock: SyncClock): string {
  const value = clock.now();
  if (!TIMESTAMP_PATTERN.test(value) || !Number.isFinite(Date.parse(value))) {
    throw new SyncWorkerError(
      "invalid_worker_configuration",
      "The synchronization clock did not return a valid timestamp.",
    );
  }
  return new Date(Date.parse(value)).toISOString();
}

export function calculateNextAttemptAt(failedAt: string, retryDelayMs: number): string {
  return new Date(Date.parse(failedAt) + retryDelayMs).toISOString();
}
