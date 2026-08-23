import {
  validateSchema,
  type DocumentManifest,
  type LegacyRegistryEntryArtifact,
  type LegacyRegistryMigrationApproval,
  type LegacyRegistryMigrationPlan,
} from "@lervo/schemas";
import {
  validateDocumentManifest,
  validateDocumentManifestSet,
} from "@lervo/project";
import { stringify } from "yaml";

import { canonicalJsonBytes, sha256 } from "./hash.js";
import {
  calculateLegacyRegistryMigrationPlanId,
  legacyRegistryEntryBytes,
} from "./integrity.js";
import { DocumentMigrationError } from "./types.js";

export interface PreparedLegacySidecar {
  documentId: string;
  path: string;
  manifest: DocumentManifest;
  bytes: Uint8Array;
  contentHash: string;
}

export interface PreparedLegacyRegistryMigration {
  approvalDigest: string;
  sidecars: readonly PreparedLegacySidecar[];
  skippedDocumentIds: readonly string[];
  entryArtifactHashes: readonly string[];
}

function compareText(left: string, right: string): number {
  return left === right ? 0 : left < right ? -1 : 1;
}

function invalidApproval(message: string): never {
  throw new DocumentMigrationError("invalid_approval", message);
}

function validateEntryArtifacts(input: {
  plan: LegacyRegistryMigrationPlan;
  entryArtifacts: readonly LegacyRegistryEntryArtifact[];
}): Map<string, LegacyRegistryEntryArtifact> {
  const entries = new Map(input.plan.entries.map((entry) => [entry.documentId, entry]));
  if (entries.size !== input.plan.entries.length || input.entryArtifacts.length !== entries.size) {
    throw new DocumentMigrationError(
      "invalid_migration_artifact",
      "The layout migration plan and entry artifact count or document IDs do not match.",
    );
  }
  const artifacts = new Map<string, LegacyRegistryEntryArtifact>();
  const references = new Map(
    input.plan.referencedDocuments.map((reference) => [reference.documentId, reference]),
  );
  if (
    references.size !== input.plan.referencedDocuments.length ||
    references.size !== input.plan.entries.length
  ) {
    throw new DocumentMigrationError(
      "invalid_migration_artifact",
      "The layout migration plan must have exactly one referenced-document snapshot for each entry.",
    );
  }
  const artifactIds = new Set<string>();
  const targetPaths = new Set<string>();
  for (const entry of input.plan.entries) {
    if (artifactIds.has(entry.artifactId) || targetPaths.has(entry.target.path)) {
      throw new DocumentMigrationError(
        "invalid_migration_artifact",
        "The layout migration plan contains duplicate artifacts or sidecar targets.",
      );
    }
    artifactIds.add(entry.artifactId);
    targetPaths.add(entry.target.path);
  }
  for (const artifact of input.entryArtifacts) {
    if (!validateSchema("legacyRegistryEntryArtifact", artifact).valid) {
      throw new DocumentMigrationError(
        "invalid_migration_artifact",
        "The legacy registry entry artifact does not satisfy the schema contract.",
      );
    }
    const bytes = legacyRegistryEntryBytes(artifact);
    const actualHash = sha256(bytes);
    const entry = entries.get(artifact.documentId);
    const reference = references.get(artifact.documentId);
    if (
      artifacts.has(artifact.documentId) || entry === undefined || reference === undefined ||
      artifact.sourceRegistryHash !== input.plan.source.contentHash ||
      artifact.contentHash !== actualHash || artifact.byteCount !== bytes.byteLength ||
      artifact.artifactId !== `art_${actualHash.slice("sha256:".length, "sha256:".length + 16)}` ||
      entry.artifactId !== artifact.artifactId || entry.artifactHash !== artifact.contentHash ||
      entry.target.path !== `.lervo/documents/${artifact.documentId}.yaml` ||
      entry.target.expected.kind !== "missing" || reference.path !== artifact.record.path
    ) {
      throw new DocumentMigrationError(
        "invalid_migration_artifact",
        "The legacy registry entry artifact bytes, ID, or plan coordinates do not match.",
      );
    }
    artifacts.set(artifact.documentId, structuredClone(artifact));
  }
  return artifacts;
}

function sidecarFromDecision(input: {
  decision: Extract<
    LegacyRegistryMigrationApproval["decisions"][number],
    { action: "approve_sidecar" }
  >;
  entry: LegacyRegistryMigrationPlan["entries"][number];
  artifact: LegacyRegistryEntryArtifact;
}): PreparedLegacySidecar {
  if (
    input.decision.manifest.documentId !== input.entry.documentId ||
    input.decision.manifest.documentId !== input.artifact.documentId ||
    input.entry.target.path !== `.lervo/documents/${input.decision.manifest.documentId}.yaml` ||
    sha256(canonicalJsonBytes(input.decision.manifest.record)) !==
      sha256(canonicalJsonBytes(input.artifact.record))
  ) {
    invalidApproval(
      "The approved sidecar does not match the legacy entry document ID, source record, or target.",
    );
  }
  const manifest = structuredClone(input.decision.manifest);
  try {
    validateDocumentManifest(manifest, `${manifest.documentId}.yaml`);
  } catch (error) {
    throw new DocumentMigrationError(
      "invalid_approval",
      "The approved legacy document manifest does not satisfy the sidecar semantic contract.",
      { cause: error },
    );
  }
  const bytes = Buffer.from(stringify(manifest, { lineWidth: 0 }), "utf8");
  if (bytes.byteLength > 64 * 1024) {
    invalidApproval("The approved legacy document manifest exceeds the sidecar size limit.");
  }
  return {
    documentId: manifest.documentId,
    path: input.entry.target.path,
    manifest,
    bytes,
    contentHash: sha256(bytes),
  };
}

export function prepareLegacyRegistryMigration(input: {
  plan: LegacyRegistryMigrationPlan;
  entryArtifacts: readonly LegacyRegistryEntryArtifact[];
  approval: LegacyRegistryMigrationApproval;
  appliedAt: string;
}): PreparedLegacyRegistryMigration {
  if (
    !validateSchema("legacyRegistryMigrationPlan", input.plan).valid ||
    input.plan.planId !== calculateLegacyRegistryMigrationPlanId(input.plan)
  ) {
    throw new DocumentMigrationError(
      "invalid_migration_artifact",
      "The legacy registry layout migration plan schema or plan ID differs from the current content.",
    );
  }
  if (input.plan.outcome === "conflict") {
    throw new DocumentMigrationError(
      "migration_conflict",
      "A legacy registry layout migration plan in conflict state cannot be applied.",
    );
  }
  const expectedArchivePath = `.lervo/archive/document-registries/sha256/${
    input.plan.source.contentHash.slice("sha256:".length)
  }.yaml`;
  const archiveExpected = input.plan.archiveTarget.expected;
  if (
    input.plan.archiveTarget.path !== expectedArchivePath ||
    archiveExpected.kind === "unsafe" ||
    (archiveExpected.kind === "file" && (
      archiveExpected.contentHash !== input.plan.source.contentHash ||
      archiveExpected.byteCount !== input.plan.source.byteCount
    )) || input.plan.manifestDirectory.expected.kind !== "missing"
  ) {
    throw new DocumentMigrationError(
      "invalid_migration_artifact",
      "The layout migration archive or manifest directory coordinates do not match the source hash.",
    );
  }
  if (!validateSchema("legacyRegistryMigrationApproval", input.approval).valid) {
    invalidApproval("The layout migration approval does not satisfy the schema contract.");
  }
  if (
    input.approval.planId !== input.plan.planId ||
    Date.parse(input.plan.generatedAt) > Date.parse(input.approval.approvedAt) ||
    Date.parse(input.approval.approvedAt) > Date.parse(input.appliedAt)
  ) {
    invalidApproval("The layout migration plan, approval, and apply time have inconsistent ordering or coordinates.");
  }

  const artifacts = validateEntryArtifacts({
    plan: input.plan,
    entryArtifacts: input.entryArtifacts,
  });
  const decisions = new Map(input.approval.decisions.map((decision) => [
    decision.documentId,
    decision,
  ]));
  if (
    decisions.size !== input.approval.decisions.length ||
    decisions.size !== input.plan.entries.length
  ) {
    invalidApproval("Every legacy registry entry must have exactly one non-duplicated approval decision.");
  }

  const sidecars: PreparedLegacySidecar[] = [];
  const skippedDocumentIds: string[] = [];
  for (const entry of input.plan.entries) {
    const artifact = artifacts.get(entry.documentId);
    const decision = decisions.get(entry.documentId);
    if (
      artifact === undefined || decision === undefined ||
      decision.artifactId !== artifact.artifactId ||
      decision.artifactHash !== artifact.contentHash
    ) {
      invalidApproval("The approval decision legacy entry artifact coordinates differ from the dry-run result.");
    }
    if (decision.action === "skip") {
      skippedDocumentIds.push(entry.documentId);
      continue;
    }
    sidecars.push(sidecarFromDecision({ decision, entry, artifact }));
  }
  try {
    validateDocumentManifestSet(sidecars.map((sidecar) => sidecar.manifest));
  } catch (error) {
    throw new DocumentMigrationError(
      "migration_conflict",
      "The approved legacy sidecar set has conflicting IDs, paths, or relations.",
      { cause: error },
    );
  }
  sidecars.sort((left, right) => compareText(left.path, right.path));
  skippedDocumentIds.sort(compareText);
  return {
    approvalDigest: sha256(canonicalJsonBytes(input.approval)),
    sidecars,
    skippedDocumentIds,
    entryArtifactHashes: [...new Set(
      input.entryArtifacts.map((artifact) => artifact.contentHash),
    )].sort(compareText),
  };
}
