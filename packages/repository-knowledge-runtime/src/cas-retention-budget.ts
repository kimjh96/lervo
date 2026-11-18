export interface ReferenceReadLimits {
  maximumReads: number;
  maximumBytes: number;
  /** Measured over reads only. Yield probes run between reads and never spend this time. */
  maximumWorkMs: number;
}

const MIB = 1024 * 1024;

/** One cycle's body scan of reference files and CAS objects; a single read is at most one MiB. */
export const REFERENCE_SCAN_LIMITS: ReferenceReadLimits = {
  maximumReads: 1024,
  maximumBytes: 64 * MIB,
  maximumWorkMs: 1000,
};

/** One cycle's immutable SQL report lookups, with the existing one-MiB per-report limit. */
export const REPORT_READ_LIMITS: ReferenceReadLimits = {
  maximumReads: 64,
  maximumBytes: 8 * MIB,
  maximumWorkMs: 100,
};

/**
 * A yield probe lists developer leases and admission state. It costs about as much as a small
 * read, so it runs at most once per this much read work.
 */
const PROBE_INTERVAL_MS = 100;

export interface ReferenceReadBudget {
  remainingBytes(): number;
  /** Whether the next read, needing `reserveBytes`, must wait for a later cycle. */
  exhausted(reserveBytes?: number): Promise<boolean>;
  read<T>(work: () => Promise<T>, bytesRead: (result: Awaited<T>) => number): Promise<Awaited<T>>;
}

export function referenceReadBudget(
  limits: ReferenceReadLimits,
  shouldYield: () => Promise<boolean>,
): ReferenceReadBudget {
  let reads = 0;
  let bytes = 0;
  let workMs = 0;
  let probedAtWorkMs = Number.NEGATIVE_INFINITY;
  return {
    remainingBytes: () => limits.maximumBytes - bytes,
    async exhausted(reserveBytes = 1) {
      if (
        reads >= limits.maximumReads ||
        limits.maximumBytes - bytes < reserveBytes ||
        workMs >= limits.maximumWorkMs
      )
        return true;
      if (workMs - probedAtWorkMs < PROBE_INTERVAL_MS) return false;
      probedAtWorkMs = workMs;
      return shouldYield();
    },
    async read<T>(
      work: () => Promise<T>,
      bytesRead: (result: Awaited<T>) => number,
    ): Promise<Awaited<T>> {
      const started = Date.now();
      try {
        const result = await work();
        bytes += bytesRead(result);
        return result;
      } finally {
        reads++;
        workMs += Date.now() - started;
      }
    },
  };
}
