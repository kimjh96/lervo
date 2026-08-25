import {
  validateSchema,
  type DocumentManifest,
  type DocumentMigrationApproval,
  type DocumentMigrationCandidateArtifact,
  type DocumentMigrationPlan,
} from "@lervo/schemas";
import { validateDocumentManifest, validateDocumentManifestSet } from "@lervo/project";
import { stringify } from "yaml";

import { canonicalJsonBytes, sha256 } from "./hash.js";
import { calculateMigrationPlanId, migrationCandidateBytes } from "./integrity.js";
import { DocumentMigrationError } from "./types.js";

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
  if (
    planEntries.size !== input.plan.candidates.length ||
    input.artifacts.length !== planEntries.size
  ) {
    throw new DocumentMigrationError(
      "invalid_migration_artifact",
      "The migration plan and candidate artifact count or IDs do not match.",
    );
  }
  const artifacts = new Map<string, DocumentMigrationCandidateArtifact>();
  for (const artifact of input.artifacts) {
    if (!validateSchema("documentMigrationCandidateArtifact", artifact).valid) {
      throw new DocumentMigrationError(
        "invalid_migration_artifact",
        "The candidate artifact does not satisfy the schema contract.",
      );
    }
    const candidate = artifact.candidate;
    const bytes = migrationCandidateBytes(candidate);
    const actualHash = sha256(bytes);
    const entry = planEntries.get(candidate.candidateId);
    if (
      artifacts.has(candidate.candidateId) ||
      entry === undefined ||
      artifact.contentHash !== actualHash ||
      artifact.byteCount !== bytes.byteLength ||
      artifact.artifactId !== `art_${actualHash.slice("sha256:".length, "sha256:".length + 16)}` ||
      entry.artifactId !== artifact.artifactId ||
      entry.artifactHash !== artifact.contentHash ||
      entry.sourcePath !== candidate.source.path ||
      entry.sourceHash !== candidate.source.contentHash
    ) {
      throw new DocumentMigrationError(
        "invalid_migration_artifact",
        "The candidate artifact bytes, ID, or plan coordinates do not match.",
      );
    }
    artifacts.set(candidate.candidateId, structuredClone(artifact));
  }
  return artifacts;
}

function sidecarFromDecision(input: {
  decision: Extract<
    DocumentMigrationApproval["decisions"][number],
    {
      action: "approve_sidecar";
    }
  >;
  entry: DocumentMigrationPlan["candidates"][number];
  artifact: DocumentMigrationCandidateArtifact;
  sourcePaths: ReadonlySet<string>;
}): PreparedMigrationSidecar {
  const candidate = input.artifact.candidate;
  const entry = input.entry;
  if (
    entry.action !== "create_sidecar" ||
    entry.target === null ||
    entry.target.expected.kind !== "missing" ||
    candidate.proposal === null ||
    input.decision.manifest.documentId !== candidate.proposal.documentId ||
    input.decision.manifest.record.path !== candidate.proposal.documentPath ||
    entry.target.path !== `.lervo/documents/${input.decision.manifest.documentId}.yaml` ||
    !input.sourcePaths.has(input.decision.manifest.record.path)
  ) {
    invalidApproval(
      "The approved sidecar does not match the candidate proposal, source snapshot, or empty target.",
    );
  }
  const manifest = structuredClone(input.decision.manifest);
  try {
    validateDocumentManifest(manifest, `${manifest.documentId}.yaml`);
  } catch (error) {
    throw new DocumentMigrationError(
      "invalid_approval",
      "The approved document manifest does not satisfy the sidecar semantic contract.",
      { cause: error },
    );
  }
  const bytes = Buffer.from(stringify(manifest, { lineWidth: 0 }), "utf8");
  if (bytes.byteLength > 64 * 1024) {
    invalidApproval("The approved document manifest exceeds the sidecar size limit.");
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
      "The migration plan schema or plan ID does not match the current content.",
    );
  }
  if (input.plan.outcome === "conflict") {
    throw new DocumentMigrationError(
      "migration_conflict",
      "A migration plan in conflict state cannot be applied.",
    );
  }
  if (!validateSchema("documentMigrationApproval", input.approval).valid) {
    invalidApproval("The migration approval does not satisfy the schema contract.");
  }
  if (
    input.approval.planId !== input.plan.planId ||
    Date.parse(input.plan.generatedAt) > Date.parse(input.approval.approvedAt) ||
    Date.parse(input.approval.approvedAt) > Date.parse(input.appliedAt)
  ) {
    invalidApproval(
      "The migration plan, approval, and apply time have inconsistent ordering or coordinates.",
    );
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
    invalidApproval(
      "Every migration candidate must have exactly one non-duplicated approval decision.",
    );
  }
  const sourcePaths = new Set(input.plan.sources.map((source) => source.path));
  const sidecars: PreparedMigrationSidecar[] = [];
  const skippedCandidateIds: string[] = [];
  for (const entry of input.plan.candidates) {
    const decision = decisions.get(entry.candidateId);
    const artifact = artifacts.get(entry.candidateId);
    if (
      decision === undefined ||
      artifact === undefined ||
      decision.artifactId !== artifact.artifactId ||
      decision.artifactHash !== artifact.contentHash
    ) {
      invalidApproval(
        "The approval decision candidate artifact coordinates differ from the dry-run result.",
      );
    }
    if (decision.action === "skip") {
      skippedCandidateIds.push(entry.candidateId);
      continue;
    }
    sidecars.push(
      sidecarFromDecision({
        decision,
        entry,
        artifact,
        sourcePaths,
      }),
    );
  }
  if (sidecars.length === 0) {
    invalidApproval("A metadata-only apply requires at least one approved sidecar.");
  }
  if (input.existingManifests.length + sidecars.length > 4096) {
    throw new DocumentMigrationError(
      "migration_conflict",
      "Applying the approved sidecars would exceed the document manifest count limit.",
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
      "An approved sidecar conflicts with the existing document manifest set.",
      { cause: error },
    );
  }
  sidecars.sort((left, right) => compareText(left.path, right.path));
  skippedCandidateIds.sort(compareText);
  return {
    approvalDigest: sha256(canonicalJsonBytes(input.approval)),
    sidecars,
    skippedCandidateIds,
    sourceHashes: [...new Set(input.plan.sources.map((source) => source.contentHash))].sort(
      compareText,
    ),
    candidateArtifactHashes: [
      ...new Set(input.candidateArtifacts.map((artifact) => artifact.contentHash)),
    ].sort(compareText),
  };
}
