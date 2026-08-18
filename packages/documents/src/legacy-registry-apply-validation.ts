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
      "구조 전환 plan과 항목 artifact 수 또는 document ID가 일치하지 않습니다.",
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
      "구조 전환 plan은 각 항목의 참조 문서 snapshot을 정확히 하나씩 가져야 합니다.",
    );
  }
  const artifactIds = new Set<string>();
  const targetPaths = new Set<string>();
  for (const entry of input.plan.entries) {
    if (artifactIds.has(entry.artifactId) || targetPaths.has(entry.target.path)) {
      throw new DocumentMigrationError(
        "invalid_migration_artifact",
        "구조 전환 plan에 중복 artifact 또는 sidecar target이 있습니다.",
      );
    }
    artifactIds.add(entry.artifactId);
    targetPaths.add(entry.target.path);
  }
  for (const artifact of input.entryArtifacts) {
    if (!validateSchema("legacyRegistryEntryArtifact", artifact).valid) {
      throw new DocumentMigrationError(
        "invalid_migration_artifact",
        "Legacy registry 항목 artifact가 schema 계약을 통과하지 못했습니다.",
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
        "Legacy registry 항목 artifact의 bytes, ID 또는 plan 좌표가 일치하지 않습니다.",
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
      "승인한 sidecar가 legacy 항목의 document ID, 원본 record 또는 target과 일치하지 않습니다.",
    );
  }
  const manifest = structuredClone(input.decision.manifest);
  try {
    validateDocumentManifest(manifest, `${manifest.documentId}.yaml`);
  } catch (error) {
    throw new DocumentMigrationError(
      "invalid_approval",
      "승인한 legacy document manifest가 sidecar 의미 계약을 통과하지 못했습니다.",
      { cause: error },
    );
  }
  const bytes = Buffer.from(stringify(manifest, { lineWidth: 0 }), "utf8");
  if (bytes.byteLength > 64 * 1024) {
    invalidApproval("승인한 legacy document manifest가 sidecar 크기 제한을 넘었습니다.");
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
      "Legacy registry 구조 전환 plan schema 또는 plan ID가 현재 내용과 다릅니다.",
    );
  }
  if (input.plan.outcome === "conflict") {
    throw new DocumentMigrationError(
      "migration_conflict",
      "Conflict 상태의 legacy registry 구조 전환 plan은 적용할 수 없습니다.",
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
      "구조 전환 archive 또는 manifest directory 좌표가 원본 hash와 일치하지 않습니다.",
    );
  }
  if (!validateSchema("legacyRegistryMigrationApproval", input.approval).valid) {
    invalidApproval("구조 전환 승인이 schema 계약을 통과하지 못했습니다.");
  }
  if (
    input.approval.planId !== input.plan.planId ||
    Date.parse(input.plan.generatedAt) > Date.parse(input.approval.approvedAt) ||
    Date.parse(input.approval.approvedAt) > Date.parse(input.appliedAt)
  ) {
    invalidApproval("구조 전환 plan, 승인과 적용 시각의 순서 또는 좌표가 맞지 않습니다.");
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
    invalidApproval("모든 legacy registry 항목에는 중복 없는 승인 결정을 하나씩 내려야 합니다.");
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
      invalidApproval("승인 결정의 legacy 항목 artifact 좌표가 dry-run 결과와 다릅니다.");
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
      "승인한 legacy sidecar 집합의 ID, path 또는 관계가 충돌합니다.",
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
