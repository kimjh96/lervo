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
import { readMaintenanceObservation } from "./maintenance-observation.js";

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

/** Metadata only. Cached verification is historical and cannot authorize an effect. */
export async function readAutonomousKnowledgeStatus(
  storage: Pick<ProjectStorage, "paths" | "manifest">,
  now = new Date(),
) {
  const root = storage.paths.repositoryRoot;
  const [observation, worker, fence] = await Promise.all([
    readMaintenanceObservation(root, storage.manifest.projectId),
    inspectKnowledgeResidentHealth(root, now).catch(() => ({
      status: "degraded" as const,
      state: null,
      heartbeatAt: null,
      reason: "maintenance_health_unavailable",
    })),
    readConvergenceOwnerFence(root),
  ]);
  const owner = fence?.verdict ?? null;
  const sameOwner =
    observation !== null &&
    observation.ownerGeneration === (owner?.holder?.generation ?? null) &&
    observation.ownerHostHash === (owner?.hostHash ?? null);
  // A host that does not own convergence never retries its own old obligation, so its local
  // observation describes that leftover, not the owner's live state: report it as stale.
  const ownedElsewhere = owner?.reason === "convergence_owner_elsewhere";
  const age =
    observation === null ? null : Math.max(0, now.getTime() - Date.parse(observation.observedAt));
  const status = observation?.status ?? {
    transport: "ready" as const,
    state: "attention_required" as const,
    debtCounts: null,
    outstanding: null,
    oldestAgeMilliseconds: null,
    activeStage: null,
    reason: "maintenance_observation_unavailable",
    lastVerifiedCurrency: null,
  };
  return {
    schemaVersion: 2,
    kind: "knowledge_maintenance.status",
    ...status,
    worker,
    owner,
    baselineCurrent: false,
    observation: {
      schemaVersion: 1,
      coverage:
        observation === null
          ? "unknown"
          : sameOwner && !ownedElsewhere && age! <= 900_000
            ? "observed"
            : "stale",
      observedAt: observation?.observedAt ?? null,
      ageMilliseconds: age,
      verifiedAt: observation?.verifiedAt ?? null,
      source:
        observation === null ? "unknown" : owner?.role === "owner" && sameOwner ? "owner" : "local",
      ownerGeneration: observation?.ownerGeneration ?? null,
      reason:
        observation === null
          ? "maintenance_observation_unavailable"
          : ownedElsewhere
            ? "maintenance_owner_elsewhere"
            : !sameOwner
              ? "maintenance_owner_changed"
              : "maintenance_currency_unverified",
    },
  };
}
