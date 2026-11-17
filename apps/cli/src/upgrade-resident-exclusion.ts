import { acquireFullCycleAdmission } from "@lervo/repository-knowledge-runtime";

import { CommandFailure } from "./command-error-output.js";
import type { CliIo } from "./types.js";

/** How long an upgrade waits for a running background knowledge cycle to yield before refusing. */
export const UPGRADE_RESIDENT_EXCLUSION_WAIT_MS = 15 * 60_000;

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
 * cycle stops at its next stage boundary instead of finishing.
 */
export async function withKnowledgeResidentExclusion<T>(
  input: {
    repositoryRoot: string;
    io: Pick<CliIo, "stderr">;
    options?: UpgradeResidentExclusionOptions | undefined;
  },
  operation: () => Promise<T>,
): Promise<T> {
  const waitMs = input.options?.waitMs ?? UPGRADE_RESIDENT_EXCLUSION_WAIT_MS;
  const deadline = AbortSignal.timeout(waitMs);
  let admission;
  try {
    admission = await acquireFullCycleAdmission({
      repositoryRoot: input.repositoryRoot,
      signal: deadline,
      priority: "upgrade",
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
  try {
    return await operation();
  } finally {
    await admission.release();
  }
}
