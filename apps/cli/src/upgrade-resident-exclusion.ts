import { acquireFullCycleAdmission } from "@lervo/repository-knowledge-runtime";

import { CommandFailure } from "./command-error-output.js";
import type { CliIo } from "./types.js";

/** How long an upgrade waits for a running background knowledge cycle to yield before refusing. */
export const UPGRADE_RESIDENT_EXCLUSION_WAIT_MS = 15 * 60_000;

/**
 * ADR-0576: how long releasing the admission retries SQLite lock contention before the upgrade
 * reports its result anyway. The holder row stops counting once this process exits.
 */
export const UPGRADE_RESIDENT_EXCLUSION_RELEASE_WAIT_MS = 30_000;

/**
 * ADR-0577: the upgrade's admission lease. It outlasts the host follower's 90-minute bound on one
 * `lervo upgrade`, so a renewal timer starved by host load cannot let the lease lapse while the
 * command still runs. Residents of every release read the lease from the holder row. A crashed
 * or killed upgrade frees the admission at once, because the holder's process is gone.
 */
export const UPGRADE_RESIDENT_EXCLUSION_LEASE_MS = 2 * 60 * 60_000;

/**
 * ADR-0577: the apply calls `assertHeld()` before each consequential stage. It throws
 * `knowledge_cycle_admission_lost` once another holder has been admitted, so the upgrade stops
 * instead of continuing without the exclusion.
 */
export interface UpgradeResidentExclusion {
  assertHeld(): Promise<void>;
}

function admissionLost(): CommandFailure {
  return new CommandFailure(
    "knowledge_cycle_admission_lost",
    "This upgrade lost the host's full-cycle admission, so a background knowledge cycle may have started. The upgrade stopped before its next stage; retry it.",
  );
}

/** Test seam: the admission directory and timing; production uses the resident's defaults. */
export interface UpgradeResidentExclusionOptions {
  directory?: string;
  pollMilliseconds?: number;
  waitMs?: number;
}

/**
 * Holds the background knowledge resident's full-cycle admission for a whole upgrade apply, so
 * no resident cycle, materialization, or knowledge commit starts until the upgrade ends. The
 * admission is the resident's own per-host lease; a replaced Node or host resident waits on it
 * and starts its first cycle after release. A crashed upgrade frees it with its process.
 * ADR-0574: the upgrade asks with priority, so it goes ahead of waiting residents and a running
 * cycle stops at its next stage boundary instead of finishing. ADR-0577: the result is returned
 * only when the admission is still held after the operation.
 */
export async function withKnowledgeResidentExclusion<T>(
  input: {
    repositoryRoot: string;
    io: Pick<CliIo, "stderr">;
    options?: UpgradeResidentExclusionOptions | undefined;
  },
  operation: (exclusion: UpgradeResidentExclusion) => Promise<T>,
): Promise<T> {
  const waitMs = input.options?.waitMs ?? UPGRADE_RESIDENT_EXCLUSION_WAIT_MS;
  const deadline = AbortSignal.timeout(waitMs);
  let admission;
  try {
    admission = await acquireFullCycleAdmission({
      repositoryRoot: input.repositoryRoot,
      signal: deadline,
      priority: "upgrade",
      leaseMilliseconds: UPGRADE_RESIDENT_EXCLUSION_LEASE_MS,
      releaseContentionWaitMilliseconds: UPGRADE_RESIDENT_EXCLUSION_RELEASE_WAIT_MS,
      ...(input.options?.directory === undefined ? {} : { directory: input.options.directory }),
      ...(input.options?.pollMilliseconds === undefined
        ? {}
        : { pollMilliseconds: input.options.pollMilliseconds }),
      onWait: () =>
        input.io.stderr(
          `Waiting up to ${Math.max(1, Math.ceil(waitMs / 60_000))} min for the running background knowledge cycle on this host to stop at its next stage boundary before upgrading.\n`,
        ),
    });
  } catch (error) {
    if ((error as { code?: unknown } | null)?.code === "knowledge_cancelled" && deadline.aborted)
      throw new CommandFailure(
        "knowledge_cycle_admission_wait_expired",
        `A background knowledge cycle on this host did not yield within ${Math.max(1, Math.ceil(waitMs / 60_000))} minutes. The upgrade changed nothing; retry after the cycle finishes.`,
      );
    throw error;
  }
  const exclusion: UpgradeResidentExclusion = {
    assertHeld: async () => {
      if (!(await admission.held())) throw admissionLost();
    },
  };
  try {
    const result = await operation(exclusion);
    // A holder that still holds was never replaced, so the whole apply ran under the exclusion.
    await exclusion.assertHeld();
    return result;
  } finally {
    await admission.release();
  }
}
