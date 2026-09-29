import type { ProjectStorage } from "@lervo/project-storage";
import { inspectKnowledgeConvergenceStatus } from "@lervo/repository-knowledge";
import { discoverConvergenceBaseline } from "./baseline.js";
import { inspectKnowledgeResidentHealth } from "./resident-health.js";
import { convergenceRecoveryStatus } from "./recovery-status.js";
import { assertNoKnowledgeMaterializationTransaction } from "@lervo/repository-knowledge";

export async function inspectAutonomousKnowledgeStatus(storage: ProjectStorage) {
  try {
    await assertNoKnowledgeMaterializationTransaction({
      repositoryRoot: storage.paths.repositoryRoot,
    });
  } catch (error) {
    if ((error as { code?: string }).code !== "knowledge_recovery_required") throw error;
    return {
      ...convergenceRecoveryStatus(storage),
      worker: await inspectKnowledgeResidentHealth(storage.paths.repositoryRoot),
      baselineCurrent: false,
    };
  }
  const baseline = await discoverConvergenceBaseline(
    storage.paths.repositoryRoot,
    storage.events,
    storage.artifacts,
  );
  const status = inspectKnowledgeConvergenceStatus({
    events: storage.events,
    baseline,
    writableEventSchemaVersion: storage.writableEventSchemaVersion ?? 1,
  });
  return {
    ...status,
    worker: await inspectKnowledgeResidentHealth(storage.paths.repositoryRoot),
    baselineCurrent:
      status.lastVerifiedCurrency?.snapshotHash === baseline.sourceSnapshotHash &&
      Object.values(baseline.debtCounts).every((count) => count === 0),
  };
}
