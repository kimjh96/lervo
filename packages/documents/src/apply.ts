import {
  validateSchema,
  type DocumentMigrationAppliedEventPayload,
  type DocumentMigrationApplyReceipt,
} from "@lervo/schemas";
import { loadDocumentManifests } from "@lervo/project";

import { publishMigrationSidecars } from "./apply-filesystem.js";
import {
  captureSidecarDirectorySnapshot,
  expectedPublishedSnapshot,
  revalidateMigrationSources,
  revalidateMigrationTargets,
  sameSidecarSnapshot,
  sidecarSnapshotHash,
} from "./apply-preflight.js";
import { prepareMigrationApproval } from "./apply-validation.js";
import { canonicalRepositoryRoot } from "./filesystem.js";
import { digestSuffix } from "./hash.js";
import {
  DocumentMigrationError,
  type ApplyDocumentMigrationInput,
  type ApplyDocumentMigrationResult,
} from "./types.js";

const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

export async function applyDocumentMigration(
  input: ApplyDocumentMigrationInput,
): Promise<ApplyDocumentMigrationResult> {
  const appliedAt = input.appliedAt ?? new Date().toISOString();
  if (
    !TIMESTAMP.test(appliedAt) || Number.isNaN(Date.parse(appliedAt)) ||
    input.eventRecorder === null || typeof input.eventRecorder?.record !== "function"
  ) {
    throw new DocumentMigrationError(
      "invalid_approval",
      "The apply time and required migration event recorder must be valid.",
    );
  }
  const root = await canonicalRepositoryRoot(input.repositoryRoot);
  await revalidateMigrationSources(root, input.plan);
  await revalidateMigrationTargets(root, input.plan);

  const snapshotBeforeLoad = await captureSidecarDirectorySnapshot(root);
  let existingManifests;
  try {
    existingManifests = await loadDocumentManifests(root);
  } catch (error) {
    throw new DocumentMigrationError(
      "migration_conflict",
      "The document manifest layout could not be verified before the metadata-only apply.",
      { cause: error },
    );
  }
  const existingSnapshot = await captureSidecarDirectorySnapshot(root);
  if (!sameSidecarSnapshot(snapshotBeforeLoad, existingSnapshot)) {
    throw new DocumentMigrationError(
      "plan_stale",
      "The document manifest set changed during apply preflight.",
    );
  }

  const prepared = prepareMigrationApproval({
    plan: structuredClone(input.plan),
    candidateArtifacts: input.candidateArtifacts.map((artifact) => structuredClone(artifact)),
    approval: structuredClone(input.approval),
    existingManifests,
    appliedAt,
  });
  const publishedSnapshot = expectedPublishedSnapshot(existingSnapshot, prepared.sidecars);
  const eventPayload: DocumentMigrationAppliedEventPayload = {
    planId: input.plan.planId,
    approvalId: input.approval.approvalId,
    approvalDigest: prepared.approvalDigest,
    beforeLayoutHash: sidecarSnapshotHash(existingSnapshot),
    afterLayoutHash: sidecarSnapshotHash(publishedSnapshot),
    sourceHashes: [...prepared.sourceHashes],
    candidateArtifactHashes: [...prepared.candidateArtifactHashes],
    sidecars: prepared.sidecars.map((sidecar) => ({
      documentId: sidecar.documentId,
      contentHash: sidecar.contentHash,
    })),
    appliedAt,
  };
  if (!validateSchema("documentMigrationAppliedEventPayload", eventPayload).valid) {
    throw new DocumentMigrationError(
      "invalid_migration_artifact",
      "The migration-applied event payload cannot be made schema-valid.",
    );
  }
  const receipt: DocumentMigrationApplyReceipt = {
    schemaVersion: 1,
    receiptId: `mgar_${digestSuffix(
      `${input.plan.planId}\0${prepared.approvalDigest}\0${appliedAt}`,
    )}`,
    planId: input.plan.planId,
    approvalId: input.approval.approvalId,
    approvalDigest: prepared.approvalDigest,
    appliedAt,
    created: prepared.sidecars.map((sidecar) => ({
      documentId: sidecar.documentId,
      path: sidecar.path,
      contentHash: sidecar.contentHash,
    })),
    skippedCandidateIds: [...prepared.skippedCandidateIds],
    eventPayload,
  };
  if (!validateSchema("documentMigrationApplyReceipt", receipt).valid) {
    throw new DocumentMigrationError(
      "invalid_migration_artifact",
      "The migration apply receipt cannot be made schema-valid.",
    );
  }

  await publishMigrationSidecars({
    root,
    planId: input.plan.planId,
    approvalId: input.approval.approvalId,
    sidecars: prepared.sidecars,
    event: { type: "document.migration.applied", payload: eventPayload },
    eventRecorder: input.eventRecorder,
    verifyBeforePublish: async (markerFileName) => {
      await revalidateMigrationSources(root, input.plan);
      await revalidateMigrationTargets(root, input.plan);
      const current = await captureSidecarDirectorySnapshot(root, markerFileName);
      if (!sameSidecarSnapshot(current, existingSnapshot)) {
        throw new DocumentMigrationError(
          "plan_stale",
          "The document manifest set changed before sidecar publication.",
        );
      }
    },
    verifyAfterPublish: async (markerFileName) => {
      await revalidateMigrationSources(root, input.plan);
      const current = await captureSidecarDirectorySnapshot(root, markerFileName);
      if (!sameSidecarSnapshot(current, publishedSnapshot)) {
        throw new DocumentMigrationError(
          "plan_stale",
          "The published sidecar set cannot be verified against the approved snapshot.",
        );
      }
    },
  });
  return structuredClone(receipt);
}
