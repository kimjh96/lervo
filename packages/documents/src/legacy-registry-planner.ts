import {
  validateSchema,
  type LegacyRegistryEntryArtifact,
  type LegacyRegistryMigrationPlan,
} from "@lervo/schemas";

import {
  canonicalRepositoryRoot,
  readStableFile,
} from "./filesystem.js";
import { sha256 } from "./hash.js";
import { calculateLegacyRegistryMigrationPlanId } from "./integrity.js";
import { parseLegacyDocumentRegistry } from "./legacy-registry.js";
import {
  canonicalLegacyRecordPath,
  legacyRecordWarnings,
  materializeLegacyRegistryEntry,
  snapshotLegacyMigrationPath,
} from "./legacy-registry-planning.js";
import {
  DocumentMigrationError,
  type LegacyRegistryMigrationDryRun,
} from "./types.js";

const LEGACY_REGISTRY_PATH = ".lervo/documents.yaml";
const MANIFEST_DIRECTORY_PATH = ".lervo/documents";
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

function compareText(left: string, right: string): number {
  return left === right ? 0 : left < right ? -1 : 1;
}

export async function createLegacyRegistryMigrationDryRun(input: {
  repositoryRoot: string;
  generatedAt?: string;
}): Promise<LegacyRegistryMigrationDryRun> {
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  if (!TIMESTAMP.test(generatedAt) || Number.isNaN(Date.parse(generatedAt))) {
    throw new DocumentMigrationError(
      "invalid_generated_at",
      "The legacy registry migration plan creation time must be valid.",
    );
  }
  const root = await canonicalRepositoryRoot(input.repositoryRoot);
  const sourceBytes = await readStableFile(root, LEGACY_REGISTRY_PATH, 4 * 1024 * 1024);
  const registry = parseLegacyDocumentRegistry(sourceBytes);
  if (registry === null) {
    throw new DocumentMigrationError(
      "invalid_legacy_registry",
      "The existing documents.yaml does not satisfy the legacy registry schema.",
    );
  }
  const documentIds = Object.keys(registry.documents).sort(compareText);
  if (documentIds.length > 4096) {
    throw new DocumentMigrationError(
      "scan_limit_exceeded",
      "The legacy registry document count exceeds the migration limit.",
    );
  }

  const sourceHash = sha256(sourceBytes);
  const archivePath = `.lervo/archive/document-registries/sha256/${sourceHash.slice("sha256:".length)}.yaml`;
  const archiveExpected = await snapshotLegacyMigrationPath(root, archivePath, 4 * 1024 * 1024);
  const directoryExpected = await snapshotLegacyMigrationPath(root, MANIFEST_DIRECTORY_PATH, 64 * 1024);
  const warnings = new Set<string>();
  let conflict = directoryExpected.kind !== "missing";
  let reviewRequired = false;
  if (conflict) warnings.add("legacy_and_sharded_layout_conflict");
  if (
    archiveExpected.kind === "unsafe" ||
    (archiveExpected.kind === "file" && (
      archiveExpected.contentHash !== sourceHash ||
      archiveExpected.byteCount !== sourceBytes.byteLength
    ))
  ) {
    conflict = true;
    warnings.add("archive_target_conflict");
  }

  const pathOwners = new Map<string, string>();
  const artifacts: LegacyRegistryEntryArtifact[] = [];
  const artifactBytes = new Map<string, Uint8Array>();
  const entries: LegacyRegistryMigrationPlan["entries"] = [];
  const referencedDocuments: LegacyRegistryMigrationPlan["referencedDocuments"] = [];
  for (const documentId of documentIds) {
    const record = registry.documents[documentId]!;
    const semanticWarnings = legacyRecordWarnings(record);
    for (const warning of semanticWarnings) warnings.add(warning);
    if (semanticWarnings.some((warning) => warning.startsWith("invalid_legacy_"))) {
      conflict = true;
    }
    if (record.ownership.mode !== "user") reviewRequired = true;
    const existingOwner = pathOwners.get(record.path);
    if (existingOwner !== undefined) {
      conflict = true;
      warnings.add("duplicate_legacy_document_path");
    } else {
      pathOwners.set(record.path, documentId);
    }
    const referencedSnapshot = canonicalLegacyRecordPath(record.path)
      ? await snapshotLegacyMigrationPath(root, record.path, 4 * 1024 * 1024)
      : { kind: "unsafe" as const, reasonCode: "invalid_legacy_record_path" };
    if (referencedSnapshot.kind === "missing") {
      reviewRequired = true;
      warnings.add("referenced_document_missing");
    } else if (referencedSnapshot.kind === "unsafe") {
      conflict = true;
      reviewRequired = true;
      warnings.add("referenced_document_unsafe");
    }
    referencedDocuments.push({
      documentId,
      path: record.path,
      snapshot: referencedSnapshot,
    });

    const materialized = materializeLegacyRegistryEntry({
      documentId,
      record,
      sourceRegistryHash: sourceHash,
    });
    artifacts.push(materialized.artifact);
    artifactBytes.set(materialized.artifact.artifactId, materialized.bytes);
    const targetPath = `.lervo/documents/${documentId}.yaml`;
    const targetExpected = await snapshotLegacyMigrationPath(root, targetPath, 64 * 1024);
    if (targetExpected.kind !== "missing") {
      conflict = true;
      warnings.add("sidecar_target_conflict");
    }
    entries.push({
      documentId,
      artifactId: materialized.artifact.artifactId,
      artifactHash: materialized.artifact.contentHash,
      target: { path: targetPath, expected: targetExpected },
    });
  }
  if (documentIds.length > 0) {
    reviewRequired = true;
    warnings.add("legacy_content_policy_requires_review");
  } else {
    warnings.add("empty_legacy_registry");
  }

  const planContent = {
    schemaVersion: 1 as const,
    mode: "legacy_registry_structural_dry_run" as const,
    writesAllowed: false as const,
    approvalStatus: "not_requested" as const,
    outcome: conflict
      ? "conflict" as const
      : reviewRequired
        ? "review_required" as const
        : "ready_for_review" as const,
    source: {
      path: LEGACY_REGISTRY_PATH as typeof LEGACY_REGISTRY_PATH,
      contentHash: sourceHash,
      byteCount: sourceBytes.byteLength,
      deactivationAction: "archive_then_remove" as const,
    },
    archiveTarget: { path: archivePath, expected: archiveExpected },
    manifestDirectory: {
      path: MANIFEST_DIRECTORY_PATH as typeof MANIFEST_DIRECTORY_PATH,
      expected: directoryExpected,
    },
    referencedDocuments,
    entries,
    warnings: [...warnings].sort(compareText),
  };
  const plan: LegacyRegistryMigrationPlan = {
    ...planContent,
    planId: calculateLegacyRegistryMigrationPlanId(planContent),
    generatedAt,
  };
  if (!validateSchema("legacyRegistryMigrationPlan", plan).valid) {
    throw new DocumentMigrationError(
      "invalid_legacy_registry",
      "The legacy registry migration dry-run plan cannot be made schema-valid.",
    );
  }
  return {
    plan: structuredClone(plan),
    entryArtifacts: artifacts.map((artifact) => structuredClone(artifact)),
    entryArtifactBytes: new Map(
      [...artifactBytes].map(([id, bytes]) => [id, new Uint8Array(bytes)]),
    ),
  };
}
