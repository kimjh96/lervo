import { HubCommandError } from "./errors.js";
import type {
  HubCommandArtifactLifecycleRepository,
  HubCommandArtifactLifecycleStore,
  HubCommandArtifactPurgeClaim,
} from "./types.js";

const WORKER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,127}$/u;

export interface HubCommandArtifactCleanupResult {
  claimedCount: number;
  deletedCount: number;
  alreadyMissingCount: number;
  purgedDeliveryCount: number;
  orphanPurgedCount: number;
  failureCount: number;
  nextInventoryCursor: string | null;
}

function timestamp(value: string, label: string): number {
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds) || milliseconds < 0) {
    throw new HubCommandError("invalid_request", `${label}이 유효하지 않습니다.`);
  }
  return milliseconds;
}

function validateInput(input: {
  workerId: string;
  cleanedAt: string;
  leaseDurationMs: number;
  orphanGraceMs: number;
  limit: number;
  inventoryCursor?: string;
  maximumScannedObjects?: number;
}): number {
  const cleanedAtMs = timestamp(input.cleanedAt, "artifact cleanedAt");
  if (
    !WORKER_PATTERN.test(input.workerId) ||
    !Number.isSafeInteger(input.leaseDurationMs) || input.leaseDurationMs < 1_000 ||
    input.leaseDurationMs > 5 * 60_000 ||
    !Number.isSafeInteger(input.orphanGraceMs) || input.orphanGraceMs < 60_000 ||
    input.orphanGraceMs > 30 * 24 * 60 * 60_000 ||
    !Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 100
  ) throw new HubCommandError("invalid_request", "artifact cleanup 실행 범위가 유효하지 않습니다.");
  return cleanedAtMs;
}

async function purgeClaim(input: {
  repository: HubCommandArtifactLifecycleRepository;
  artifacts: HubCommandArtifactLifecycleStore;
  claim: HubCommandArtifactPurgeClaim;
  completedAt: string;
}): Promise<{ deleted: boolean; purgedDeliveryCount: number; orphanPurged: boolean }> {
  try {
    const deletion = await input.artifacts.deleteObject(input.claim.artifactUri);
    const completed = await input.repository.completeArtifactPurge({
      claimId: input.claim.claimId,
      workerId: input.claim.workerId,
      completedAt: input.completedAt,
    });
    return {
      deleted: deletion.deleted,
      purgedDeliveryCount: completed.purgedDeliveryCount,
      orphanPurged: input.claim.kind === "orphan" && completed.status === "completed",
    };
  } catch (error) {
    try {
      await input.repository.releaseArtifactPurgeClaim({
        claimId: input.claim.claimId,
        workerId: input.claim.workerId,
        releasedAt: input.completedAt,
      });
    } catch {
      // An expired or already completed claim is recovered idempotently by a later cycle.
    }
    throw error;
  }
}

/** Runs one bounded cleanup cycle. Callers persist and feed back nextInventoryCursor. */
export async function cleanupHubCommandArtifacts(input: {
  repository: HubCommandArtifactLifecycleRepository;
  artifacts: HubCommandArtifactLifecycleStore;
  workerId: string;
  cleanedAt: string;
  leaseDurationMs?: number;
  orphanGraceMs?: number;
  limit?: number;
  inventoryCursor?: string;
  maximumScannedObjects?: number;
}): Promise<HubCommandArtifactCleanupResult> {
  const leaseDurationMs = input.leaseDurationMs ?? 60_000;
  const orphanGraceMs = input.orphanGraceMs ?? 24 * 60 * 60_000;
  const limit = input.limit ?? 100;
  const cleanedAtMs = validateInput({ ...input, leaseDurationMs, orphanGraceMs, limit });
  const result: HubCommandArtifactCleanupResult = {
    claimedCount: 0,
    deletedCount: 0,
    alreadyMissingCount: 0,
    purgedDeliveryCount: 0,
    orphanPurgedCount: 0,
    failureCount: 0,
    nextInventoryCursor: null,
  };
  const expired = await input.repository.claimExpiredArtifacts({
    workerId: input.workerId,
    claimedAt: input.cleanedAt,
    leaseDurationMs,
    limit,
  });
  for (const claim of expired) {
    result.claimedCount += 1;
    try {
      const purged = await purgeClaim({
        repository: input.repository,
        artifacts: input.artifacts,
        claim,
        completedAt: input.cleanedAt,
      });
      purged.deleted ? result.deletedCount += 1 : result.alreadyMissingCount += 1;
      result.purgedDeliveryCount += purged.purgedDeliveryCount;
    } catch {
      result.failureCount += 1;
    }
  }

  const remaining = limit - expired.length;
  if (remaining === 0) return result;
  const inventory = await input.artifacts.listObjects({
    ...(input.inventoryCursor === undefined ? {} : { after: input.inventoryCursor }),
    limit: remaining,
    ...(input.maximumScannedObjects === undefined ? {} : {
      maximumScannedObjects: input.maximumScannedObjects,
    }),
  });
  result.nextInventoryCursor = inventory.nextCursor;
  for (const item of inventory.items) {
    if (timestamp(item.modifiedAt, "artifact modifiedAt") > cleanedAtMs - orphanGraceMs) continue;
    let claim: HubCommandArtifactPurgeClaim | null;
    try {
      claim = await input.repository.claimOrphanArtifact({
        workerId: input.workerId,
        artifactUri: item.uri,
        observedModifiedAt: item.modifiedAt,
        claimedAt: input.cleanedAt,
        leaseDurationMs,
      });
    } catch {
      result.failureCount += 1;
      continue;
    }
    if (claim === null) continue;
    result.claimedCount += 1;
    try {
      const purged = await purgeClaim({
        repository: input.repository,
        artifacts: input.artifacts,
        claim,
        completedAt: input.cleanedAt,
      });
      purged.deleted ? result.deletedCount += 1 : result.alreadyMissingCount += 1;
      result.purgedDeliveryCount += purged.purgedDeliveryCount;
      if (purged.orphanPurged) result.orphanPurgedCount += 1;
    } catch {
      result.failureCount += 1;
    }
  }
  return result;
}
