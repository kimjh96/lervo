import {
  validateSchema,
  type LegacyRegistryMigrationAppliedEventPayload,
  type LegacyRegistryMigrationApplyReceipt,
} from "@lervo/schemas";

import { canonicalRepositoryRoot } from "./filesystem.js";
import { digestSuffix } from "./hash.js";
import { publishLegacyRegistryMigration } from "./legacy-registry-apply-filesystem.js";
import {
  assertSafeLervoDirectory,
  revalidateLegacyRegistryPlanBefore,
  structuralLayoutHash,
  verifyLegacyRegistryPublished,
  verifyLegacyRegistryReadyForTransition,
} from "./legacy-registry-apply-preflight.js";
import { prepareLegacyRegistryMigration } from "./legacy-registry-apply-validation.js";
import {
  DocumentMigrationError,
  type ApplyLegacyRegistryMigrationInput,
  type ApplyLegacyRegistryMigrationResult,
} from "./types.js";

const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

export async function applyLegacyRegistryMigration(
  input: ApplyLegacyRegistryMigrationInput,
): Promise<ApplyLegacyRegistryMigrationResult> {
  const appliedAt = input.appliedAt ?? new Date().toISOString();
  if (
    !TIMESTAMP.test(appliedAt) || Number.isNaN(Date.parse(appliedAt)) ||
    input.eventRecorder === null || typeof input.eventRecorder?.record !== "function" ||
    (input.failureInjector !== undefined && typeof input.failureInjector !== "function")
  ) {
    throw new DocumentMigrationError(
      "invalid_approval",
      "구조 전환 적용 시각, event recorder와 failure injector가 유효해야 합니다.",
    );
  }
  const prepared = prepareLegacyRegistryMigration({
    plan: structuredClone(input.plan),
    entryArtifacts: input.entryArtifacts.map((artifact) => structuredClone(artifact)),
    approval: structuredClone(input.approval),
    appliedAt,
  });
  const root = await canonicalRepositoryRoot(input.repositoryRoot);
  await assertSafeLervoDirectory(root);
  const sourceBytes = await revalidateLegacyRegistryPlanBefore(root, input.plan);
  const expectedSidecars = new Map(
    prepared.sidecars.map((sidecar) => [sidecar.path, sidecar.contentHash]),
  );
  const beforeLayoutHash = structuralLayoutHash({
    mode: "legacy_registry",
    sourceRegistryHash: input.plan.source.contentHash,
  });
  const afterLayoutHash = structuralLayoutHash({
    mode: "sharded_manifests",
    sidecars: expectedSidecars,
  });
  const eventPayload: LegacyRegistryMigrationAppliedEventPayload = {
    migrationKind: "legacy_registry_structural",
    planId: input.plan.planId,
    approvalId: input.approval.approvalId,
    approvalDigest: prepared.approvalDigest,
    sourceRegistryHash: input.plan.source.contentHash,
    entryArtifactHashes: [...prepared.entryArtifactHashes],
    archiveContentHash: input.plan.source.contentHash,
    beforeLayoutHash,
    afterLayoutHash,
    sidecars: prepared.sidecars.map((sidecar) => ({
      documentId: sidecar.documentId,
      contentHash: sidecar.contentHash,
    })),
    appliedAt,
  };
  if (!validateSchema("legacyRegistryMigrationAppliedEventPayload", eventPayload).valid) {
    throw new DocumentMigrationError(
      "invalid_migration_artifact",
      "Legacy registry 구조 전환 event payload를 schema-valid하게 만들 수 없습니다.",
    );
  }
  const receipt: LegacyRegistryMigrationApplyReceipt = {
    schemaVersion: 1,
    receiptId: `lgar_${digestSuffix(
      `${input.plan.planId}\0${prepared.approvalDigest}\0${appliedAt}`,
    )}`,
    planId: input.plan.planId,
    approvalId: input.approval.approvalId,
    approvalDigest: prepared.approvalDigest,
    appliedAt,
    archive: {
      path: input.plan.archiveTarget.path,
      contentHash: input.plan.source.contentHash,
    },
    deactivatedSource: {
      path: input.plan.source.path,
      contentHash: input.plan.source.contentHash,
      action: "removed",
    },
    created: prepared.sidecars.map((sidecar) => ({
      documentId: sidecar.documentId,
      path: sidecar.path,
      contentHash: sidecar.contentHash,
    })),
    skippedDocumentIds: [...prepared.skippedDocumentIds],
    eventPayload,
  };
  if (!validateSchema("legacyRegistryMigrationApplyReceipt", receipt).valid) {
    throw new DocumentMigrationError(
      "invalid_migration_artifact",
      "Legacy registry 구조 전환 receipt를 schema-valid하게 만들 수 없습니다.",
    );
  }

  await publishLegacyRegistryMigration({
    root,
    planId: input.plan.planId,
    approvalId: input.approval.approvalId,
    sourceBytes,
    sourceHash: input.plan.source.contentHash,
    archivePath: input.plan.archiveTarget.path,
    archiveAlreadyExists: input.plan.archiveTarget.expected.kind === "file",
    sidecars: prepared.sidecars,
    expectedSidecars,
    event: { type: "document.migration.applied", payload: eventPayload },
    eventRecorder: input.eventRecorder,
    verifyBeforeTransition: async () => {
      await verifyLegacyRegistryReadyForTransition(root, input.plan);
    },
    verifyAfterTransition: async () => {
      await verifyLegacyRegistryPublished({
        root,
        plan: input.plan,
        expectedSidecars,
      });
    },
    ...(input.failureInjector === undefined
      ? {}
      : { failureInjector: input.failureInjector }),
  });
  return structuredClone(receipt);
}
