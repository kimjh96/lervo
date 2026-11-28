// ADR-0660: the resident's retention-only wake. It runs one retention slice and nothing else: no
// provider call, no other stage and no worker cycle, under the same owner hold, base-branch rule
// (ADR-0610), host admission, worker lock and host retention turn as a full cycle's retention.
import { withProcessCostScope } from "@lervo/repository-knowledge";
import type { ProjectStorage } from "@lervo/project-storage";
import { readRepositoryHold } from "@lervo/repository-registry";

import { runCasRetentionSlice, type CasRetentionSlice } from "./cas-retention-slice.js";
import { checkoutOnBaseBranch } from "./checkout-base-branch.js";
import { requestRetentionTurn, returnRetentionTurn } from "./cas-retention-host-turns.js";
import { acquireFullCycleAdmission, fullCycleAdmissionDirectory } from "./full-cycle-admission.js";

/**
 * - `held`, `off_base`: the repository takes no Lervo effect now; a full cycle, which the release
 *   or checkout switch wakes, looks again.
 * - `live_work`: a developer lease is current, so the slice did not start.
 * - `turn_deferred`: another repository's turn, or the host's pause; come back at `retryAt`.
 * - `admission_busy`: this repository had the turn, but a full cycle holds or waits for the host
 *   admission; the turn was given back.
 */
export type RetentionOnlyOutcome =
  | { kind: "held" | "off_base" | "admission_busy" | "live_work" }
  | { kind: "turn_deferred"; retryAt: number }
  | { kind: "slice"; slice: CasRetentionSlice };

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
  const turnInput = { directory, repositoryRoot: root };
  // The turn comes first, so repositories that are not served never touch the admission.
  const turn = await requestRetentionTurn({ ...turnInput, now: Date.now() });
  if (!turn.granted) return { kind: "turn_deferred", retryAt: turn.retryAt };
  let admission: Awaited<ReturnType<typeof acquireFullCycleAdmission>>;
  try {
    admission = await acquireFullCycleAdmission({
      repositoryRoot: root,
      signal: input.signal,
      directory,
      priority: "retention",
    });
  } catch (error) {
    await returnRetentionTurn({ ...turnInput, previousSliceAt: turn.previousSliceAt });
    if ((error as { code?: unknown } | null)?.code === "knowledge_admission_occupied")
      return { kind: "admission_busy" };
    throw error;
  }
  try {
    const slice = await runCasRetentionSlice({
      storage: input.storage,
      directory,
      turn,
      shouldYield: async () =>
        input.signal.aborted || (await input.liveWorkPending()) || (await admission.contended()),
    });
    return { kind: "slice", slice };
  } finally {
    await admission.release();
  }
}
