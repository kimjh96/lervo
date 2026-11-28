// ADR-0660: the resident's retention-only wake. It runs one retention slice and nothing else: no
// provider call, no other stage and no worker cycle, under the same owner hold, base-branch rule
// (ADR-0610), host admission, worker lock and host retention turn as a full cycle's retention.
import { withProcessCostScope } from "@lervo/repository-knowledge";
import type { ProjectStorage } from "@lervo/project-storage";
import { readRepositoryHold } from "@lervo/repository-registry";

import { runCasRetentionSlice, type CasRetentionSlice } from "./cas-retention-slice.js";
import { checkoutOnBaseBranch } from "./checkout-base-branch.js";
import { acquireFullCycleAdmission, fullCycleAdmissionDirectory } from "./full-cycle-admission.js";
import { admissionOccupied } from "./full-cycle-admission-queue.js";

/**
 * - `held`, `off_base`: the repository takes no Lervo effect now; a full cycle, which the release
 *   or checkout switch wakes, looks again.
 * - `admission_busy`: a full cycle holds or waits for the host admission.
 * - `live_work`: a developer lease is current, so the slice did not start.
 */
export type RetentionOnlyOutcome =
  | { kind: "held" | "off_base" | "admission_busy" | "live_work" }
  | { kind: "slice"; slice: CasRetentionSlice };

function cancelled(error: unknown): boolean {
  return (error as { code?: unknown } | null)?.code === "knowledge_cancelled";
}

interface RetentionOnlyInput {
  storage: ProjectStorage;
  admissionDirectory?: string;
  signal: AbortSignal;
  liveWorkPending: () => Promise<boolean>;
}

/** Every check and the slice itself count as artifact retention in the process cost. */
export function runRetentionOnlySlice(input: RetentionOnlyInput): Promise<RetentionOnlyOutcome> {
  return withProcessCostScope("artifact_retention", () => retentionOnlySlice(input));
}

async function retentionOnlySlice(input: RetentionOnlyInput): Promise<RetentionOnlyOutcome> {
  const root = input.storage.paths.repositoryRoot;
  if ((await readRepositoryHold(root)) !== null) return { kind: "held" };
  if (!(await checkoutOnBaseBranch(root)).onBase) return { kind: "off_base" };
  if (await input.liveWorkPending()) return { kind: "live_work" };
  const directory = fullCycleAdmissionDirectory(input.admissionDirectory);
  if (await admissionOccupied(directory, Date.now())) return { kind: "admission_busy" };
  // Admitted at once or not at all: a slice never waits in the queue.
  const notWaiting = new AbortController();
  let admission: Awaited<ReturnType<typeof acquireFullCycleAdmission>>;
  try {
    admission = await acquireFullCycleAdmission({
      repositoryRoot: root,
      signal: AbortSignal.any([input.signal, notWaiting.signal]),
      directory,
      onWait: () => notWaiting.abort(),
    });
  } catch (error) {
    if (cancelled(error) && !input.signal.aborted) return { kind: "admission_busy" };
    throw error;
  }
  try {
    const slice = await runCasRetentionSlice({
      storage: input.storage,
      directory,
      shouldYield: async () =>
        input.signal.aborted || (await input.liveWorkPending()) || (await admission.contended()),
    });
    return { kind: "slice", slice };
  } finally {
    await admission.release();
  }
}
