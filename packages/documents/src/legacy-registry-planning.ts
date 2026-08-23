import { posix } from "node:path";

import {
  validateSchema,
  type DocumentRecord,
  type LegacyRegistryEntryArtifact,
  type LegacyRegistryMigrationPlan,
} from "@lervo/schemas";

import { inspectTargetFile } from "./filesystem.js";
import { sha256 } from "./hash.js";
import { legacyRegistryEntryBytes } from "./integrity.js";
import { DocumentMigrationError } from "./types.js";

export type LegacyMigrationPathSnapshot =
  LegacyRegistryMigrationPlan["archiveTarget"]["expected"];

export function canonicalLegacyRecordPath(path: string): boolean {
  return path !== "." && !path.endsWith("/") && !path.includes("\\") &&
    posix.normalize(path) === path;
}

export function legacyRecordWarnings(record: DocumentRecord): string[] {
  const warnings: string[] = [];
  if (!canonicalLegacyRecordPath(record.path)) warnings.push("invalid_legacy_record_path");
  if (record.connectedPaths.some((path) => !canonicalLegacyRecordPath(path))) {
    warnings.push("invalid_legacy_connected_path");
  }
  if (
    record.ownership.mode === "lervo_generated" &&
    !canonicalLegacyRecordPath(record.ownership.manifestPath)
  ) {
    warnings.push("invalid_legacy_generation_manifest_path");
  }
  if (record.ownership.mode === "managed_blocks") {
    warnings.push("legacy_managed_blocks_require_review");
  }
  if (record.ownership.mode === "lervo_generated") {
    warnings.push("legacy_generated_document_requires_review");
  }
  return warnings;
}

export async function snapshotLegacyMigrationPath(
  root: string,
  path: string,
  maximumBytes: number,
): Promise<LegacyMigrationPathSnapshot> {
  try {
    const inspected = await inspectTargetFile(root, path, maximumBytes);
    return inspected.kind === "file"
      ? {
          kind: "file",
          contentHash: sha256(inspected.bytes),
          byteCount: inspected.bytes.byteLength,
        }
      : inspected;
  } catch {
    return { kind: "unsafe", reasonCode: "target_unsafe" };
  }
}

export function materializeLegacyRegistryEntry(input: {
  documentId: string;
  record: DocumentRecord;
  sourceRegistryHash: string;
}): { artifact: LegacyRegistryEntryArtifact; bytes: Uint8Array } {
  const content = {
    schemaVersion: 1 as const,
    sourceRegistryHash: input.sourceRegistryHash,
    documentId: input.documentId,
    record: structuredClone(input.record),
  };
  const bytes = legacyRegistryEntryBytes(content);
  if (bytes.byteLength > 1024 * 1024) {
    throw new DocumentMigrationError(
      "scan_limit_exceeded",
      `The legacy registry entry artifact exceeds the size limit: ${input.documentId}`,
    );
  }
  const contentHash = sha256(bytes);
  const artifact: LegacyRegistryEntryArtifact = {
    ...content,
    artifactId: `art_${contentHash.slice("sha256:".length, "sha256:".length + 16)}`,
    contentHash,
    byteCount: bytes.byteLength,
  };
  if (!validateSchema("legacyRegistryEntryArtifact", artifact).valid) {
    throw new DocumentMigrationError(
      "invalid_legacy_registry",
      `The legacy registry entry cannot be made into a schema-valid artifact: ${input.documentId}`,
    );
  }
  return { artifact, bytes };
}
