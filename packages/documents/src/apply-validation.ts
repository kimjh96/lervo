import {
  validateSchema,
  type DocumentManifest,
  type DocumentMigrationApproval,
  type DocumentMigrationCandidateArtifact,
  type DocumentMigrationPlan,
} from "@lervo/schemas";
import {
  validateDocumentManifest,
  validateDocumentManifestSet,
} from "@lervo/project";
import { stringify } from "yaml";

import { canonicalJsonBytes, sha256 } from "./hash.js";
import { calculateMigrationPlanId, migrationCandidateBytes } from "./integrity.js";
import {
  DocumentMigrationError,
} from "./types.js";

export interface PreparedMigrationSidecar {
  documentId: string;
  path: string;
  manifest: DocumentManifest;
  bytes: Uint8Array;
  contentHash: string;
}

export interface PreparedMigrationApproval {
  approvalDigest: string;
  sidecars: readonly PreparedMigrationSidecar[];
  skippedCandidateIds: readonly string[];
  sourceHashes: readonly string[];
  candidateArtifactHashes: readonly string[];
}

function compareText(left: string, right: string): number {
  return left === right ? 0 : left < right ? -1 : 1;
}

function invalidApproval(message: string): never {
  throw new DocumentMigrationError("invalid_approval", message);
}

function validatedArtifacts(input: {
  plan: DocumentMigrationPlan;
  artifacts: readonly DocumentMigrationCandidateArtifact[];
}): Map<string, DocumentMigrationCandidateArtifact> {
  const planEntries = new Map(input.plan.candidates.map((entry) => [entry.candidateId, entry]));
  if (planEntries.size !== input.plan.candidates.length || input.artifacts.length !== planEntries.size) {
    throw new DocumentMigrationError(
      "invalid_migration_artifact",
      "Migration plan과 candidate artifact 수 또는 ID가 일치하지 않습니다.",
    );
  }
  const artifacts = new Map<string, DocumentMigrationCandidateArtifact>();
  for (const artifact of input.artifacts) {
    if (!validateSchema("documentMigrationCandidateArtifact", artifact).valid) {
      throw new DocumentMigrationError(
        "invalid_migration_artifact",
        "Candidate artifact가 schema 계약을 통과하지 못했습니다.",
      );
    }
    const candidate = artifact.candidate;
    const bytes = migrationCandidateBytes(candidate);
    const actualHash = sha256(bytes);
    const entry = planEntries.get(candidate.candidateId);
    if (
      artifacts.has(candidate.candidateId) || entry === undefined ||
      artifact.contentHash !== actualHash || artifact.byteCount !== bytes.byteLength ||
      artifact.artifactId !== `art_${actualHash.slice("sha256:".length, "sha256:".length + 16)}` ||
      entry.artifactId !== artifact.artifactId || entry.artifactHash !== artifact.contentHash ||
      entry.sourcePath !== candidate.source.path || entry.sourceHash !== candidate.source.contentHash
    ) {
      throw new DocumentMigrationError(
        "invalid_migration_artifact",
        "Candidate artifact의 bytes, ID 또는 plan 좌표가 일치하지 않습니다.",
      );
    }
    artifacts.set(candidate.candidateId, structuredClone(artifact));
  }
  return artifacts;
}

function sidecarFromDecision(input: {
  decision: Extract<DocumentMigrationApproval["decisions"][number], {
    action: "approve_sidecar";
  }>;
  entry: DocumentMigrationPlan["candidates"][number];
  artifact: DocumentMigrationCandidateArtifact;
  sourcePaths: ReadonlySet<string>;
}): PreparedMigrationSidecar {
  const candidate = input.artifact.candidate;
  const entry = input.entry;
  if (
    entry.action !== "create_sidecar" || entry.target === null ||
    entry.target.expected.kind !== "missing" || candidate.proposal === null ||
    input.decision.manifest.documentId !== candidate.proposal.documentId ||
    input.decision.manifest.record.path !== candidate.proposal.documentPath ||
    entry.target.path !== `.lervo/documents/${input.decision.manifest.documentId}.yaml` ||
    !input.sourcePaths.has(input.decision.manifest.record.path)
  ) {
    invalidApproval(
      "승인한 sidecar가 candidate 제안, source snapshot 또는 빈 target과 일치하지 않습니다.",
    );
  }
  const manifest = structuredClone(input.decision.manifest);
  try {
    validateDocumentManifest(manifest, `${manifest.documentId}.yaml`);
  } catch (error) {
    throw new DocumentMigrationError(
      "invalid_approval",
      "승인한 document manifest가 sidecar 의미 계약을 통과하지 못했습니다.",
      { cause: error },
    );
  }
  const bytes = Buffer.from(stringify(manifest, { lineWidth: 0 }), "utf8");
  if (bytes.byteLength > 64 * 1024) {
    invalidApproval("승인한 document manifest가 sidecar 크기 제한을 넘었습니다.");
  }
  return {
    documentId: manifest.documentId,
    path: entry.target.path,
    manifest,
    bytes,
    contentHash: sha256(bytes),
  };
}

export function prepareMigrationApproval(input: {
  plan: DocumentMigrationPlan;
  candidateArtifacts: readonly DocumentMigrationCandidateArtifact[];
  approval: DocumentMigrationApproval;
  existingManifests: readonly DocumentManifest[];
  appliedAt: string;
}): PreparedMigrationApproval {
  if (
    !validateSchema("documentMigrationPlan", input.plan).valid ||
    input.plan.planId !== calculateMigrationPlanId(input.plan)
  ) {
    throw new DocumentMigrationError(
      "invalid_migration_artifact",
      "Migration plan schema 또는 plan ID가 현재 내용과 일치하지 않습니다.",
    );
  }
  if (input.plan.outcome === "conflict") {
    throw new DocumentMigrationError(
      "migration_conflict",
      "Conflict 상태의 migration plan은 적용할 수 없습니다.",
    );
  }
  if (!validateSchema("documentMigrationApproval", input.approval).valid) {
    invalidApproval("Migration approval이 schema 계약을 통과하지 못했습니다.");
  }
  if (
    input.approval.planId !== input.plan.planId ||
    Date.parse(input.plan.generatedAt) > Date.parse(input.approval.approvedAt) ||
    Date.parse(input.approval.approvedAt) > Date.parse(input.appliedAt)
  ) {
    invalidApproval("Migration plan, 승인과 적용 시각의 순서 또는 좌표가 맞지 않습니다.");
  }

  const artifacts = validatedArtifacts({
    plan: input.plan,
    artifacts: input.candidateArtifacts,
  });
  const decisions = new Map(input.approval.decisions.map((item) => [item.candidateId, item]));
  if (
    decisions.size !== input.approval.decisions.length ||
    decisions.size !== input.plan.candidates.length
  ) {
    invalidApproval("모든 migration candidate에는 중복 없는 승인 결정을 하나씩 내려야 합니다.");
  }
  const sourcePaths = new Set(input.plan.sources.map((source) => source.path));
  const sidecars: PreparedMigrationSidecar[] = [];
  const skippedCandidateIds: string[] = [];
  for (const entry of input.plan.candidates) {
    const decision = decisions.get(entry.candidateId);
    const artifact = artifacts.get(entry.candidateId);
    if (
      decision === undefined || artifact === undefined ||
      decision.artifactId !== artifact.artifactId ||
      decision.artifactHash !== artifact.contentHash
    ) {
      invalidApproval("승인 결정의 candidate artifact 좌표가 dry-run 결과와 다릅니다.");
    }
    if (decision.action === "skip") {
      skippedCandidateIds.push(entry.candidateId);
      continue;
    }
    sidecars.push(sidecarFromDecision({
      decision,
      entry,
      artifact,
      sourcePaths,
    }));
  }
  if (sidecars.length === 0) {
    invalidApproval("Metadata-only apply에는 승인된 sidecar가 하나 이상 필요합니다.");
  }
  if (input.existingManifests.length + sidecars.length > 4096) {
    throw new DocumentMigrationError(
      "migration_conflict",
      "승인한 sidecar를 적용하면 document manifest 수 제한을 넘습니다.",
    );
  }
  try {
    validateDocumentManifestSet([
      ...input.existingManifests.map((manifest) => structuredClone(manifest)),
      ...sidecars.map((sidecar) => structuredClone(sidecar.manifest)),
    ]);
  } catch (error) {
    throw new DocumentMigrationError(
      "migration_conflict",
      "승인한 sidecar가 기존 document manifest 집합과 충돌합니다.",
      { cause: error },
    );
  }
  sidecars.sort((left, right) => compareText(left.path, right.path));
  skippedCandidateIds.sort(compareText);
  return {
    approvalDigest: sha256(canonicalJsonBytes(input.approval)),
    sidecars,
    skippedCandidateIds,
    sourceHashes: [...new Set(input.plan.sources.map((source) => source.contentHash))]
      .sort(compareText),
    candidateArtifactHashes: [...new Set(
      input.candidateArtifacts.map((artifact) => artifact.contentHash),
    )].sort(compareText),
  };
}
