import type { ProjectStorage } from "@lervo/project-storage";
import {
  assertNoKnowledgeMaterializationTransaction,
  inspectKnowledgeConvergenceStatus,
  type KnowledgeConvergenceStatus,
} from "@lervo/repository-knowledge";
import { discoverConvergenceBaseline } from "./baseline.js";
import { readConvergenceOwnerFence } from "./convergence-owner-fence.js";
import { inspectKnowledgeResidentHealth } from "./resident-health.js";
import { convergenceRecoveryStatus } from "./recovery-status.js";
import { withNormalizationScopeGap } from "./normalization-scope-gap.js";
import { withParkedSourcesStatus } from "./convergence-parking.js";
import { withVerificationChangesStatus } from "./verification-source-changes.js";

/**
 * Read-only debt detection: currency, normalization, and candidate inspection without a baseline
 * event, provider call, document write, or commit. Non-owner hosts run only this.
 */
export async function inspectConvergenceDebt(
  storage: ProjectStorage,
): Promise<{ status: KnowledgeConvergenceStatus; baselineCurrent: boolean }> {
  try {
    await assertNoKnowledgeMaterializationTransaction({
      repositoryRoot: storage.paths.repositoryRoot,
    });
  } catch (error) {
    if ((error as { code?: string }).code !== "knowledge_recovery_required") throw error;
    return { status: convergenceRecoveryStatus(storage), baselineCurrent: false };
  }
  const baseline = await discoverConvergenceBaseline(
    storage.paths.repositoryRoot,
    storage.events,
    storage.artifacts,
  );
  const status = await withVerificationChangesStatus(
    storage,
    await withParkedSourcesStatus(
      storage,
      await withNormalizationScopeGap(
        storage,
        inspectKnowledgeConvergenceStatus({
          events: storage.events,
          baseline,
          writableEventSchemaVersion: storage.writableEventSchemaVersion ?? 1,
        }),
      ),
    ),
  );
  return {
    status,
    baselineCurrent:
      status.lastVerifiedCurrency?.snapshotHash === baseline.sourceSnapshotHash &&
      Object.values(baseline.debtCounts).every((count) => count === 0),
  };
}

export async function inspectAutonomousKnowledgeStatus(storage: ProjectStorage) {
  const root = storage.paths.repositoryRoot;
  const { status, baselineCurrent } = await inspectConvergenceDebt(storage);
  return {
    ...status,
    worker: await inspectKnowledgeResidentHealth(root),
    owner: (await readConvergenceOwnerFence(root))?.verdict ?? null,
    baselineCurrent,
  };
}
