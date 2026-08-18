import {
  validateSchema,
  type DocumentMigrationCandidateArtifact,
  type DocumentMigrationPlan,
} from "@roven/schemas";

import { builtInDocumentImportAdapters } from "./adapters.js";
import { canonicalRepositoryRoot, inspectTargetFile } from "./filesystem.js";
import { sha256 } from "./hash.js";
import { importDocumentSources } from "./import.js";
import { calculateMigrationPlanId } from "./integrity.js";
import { scanDocumentSources } from "./scanner.js";
import {
  DocumentMigrationError,
  type DocumentImportAdapter,
  type DocumentMigrationDryRun,
  type DocumentScanLimits,
} from "./types.js";

const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

function compareText(left: string, right: string): number {
  return left === right ? 0 : left < right ? -1 : 1;
}

async function candidatePlanEntry(
  root: string,
  artifact: DocumentMigrationCandidateArtifact,
): Promise<DocumentMigrationPlan["candidates"][number]> {
  const candidate = artifact.candidate;
  if (candidate.proposal === null) {
    return {
      candidateId: candidate.candidateId,
      artifactId: artifact.artifactId,
      artifactHash: artifact.contentHash,
      sourcePath: candidate.source.path,
      sourceHash: candidate.source.contentHash,
      action: "observe_only",
      target: null,
    };
  }
  const path = `.roven/documents/${candidate.proposal.documentId}.yaml`;
  const inspected = await inspectTargetFile(root, path, 64 * 1024);
  const expected = inspected.kind === "file"
    ? {
        kind: "file" as const,
        contentHash: sha256(inspected.bytes),
        byteCount: inspected.bytes.byteLength,
      }
    : inspected;
  return {
    candidateId: candidate.candidateId,
    artifactId: artifact.artifactId,
    artifactHash: artifact.contentHash,
    sourcePath: candidate.source.path,
    sourceHash: candidate.source.contentHash,
    action: "create_sidecar",
    target: { path, expected },
  };
}

function planWarnings(
  artifacts: readonly DocumentMigrationCandidateArtifact[],
  entries: readonly DocumentMigrationPlan["candidates"][number][],
  sourcePaths: ReadonlySet<string>,
): { warnings: string[]; conflict: boolean; reviewRequired: boolean } {
  const warnings = new Set<string>();
  const documentIds = new Set<string>();
  const documentPaths = new Set<string>();
  let conflict = false;
  let reviewRequired = false;
  for (const artifact of artifacts) {
    const candidate = artifact.candidate;
    if (candidate.disposition !== "ready_for_approval") {
      reviewRequired = true;
      warnings.add(candidate.disposition === "observed"
        ? "observed_source"
        : "candidate_review_required");
    }
    if (candidate.proposal === null) continue;
    if (
      candidate.source.formatId === "roven_legacy_registry" &&
      !sourcePaths.has(candidate.proposal.documentPath)
    ) {
      reviewRequired = true;
      warnings.add("referenced_document_not_scanned");
    }
    if (
      documentIds.has(candidate.proposal.documentId) ||
      documentPaths.has(candidate.proposal.documentPath)
    ) {
      conflict = true;
      warnings.add("duplicate_document_proposal");
    }
    documentIds.add(candidate.proposal.documentId);
    documentPaths.add(candidate.proposal.documentPath);
  }
  for (const entry of entries) {
    if (entry.target === null || entry.target.expected.kind === "missing") continue;
    conflict = true;
    warnings.add(entry.target.expected.kind === "file" ? "target_exists" : "target_unsafe");
  }
  return { warnings: [...warnings].sort(compareText), conflict, reviewRequired };
}

export async function createDocumentMigrationDryRun(input: {
  repositoryRoot: string;
  roots: readonly string[];
  excludePaths?: readonly string[];
  limits?: Partial<DocumentScanLimits>;
  adapters?: readonly DocumentImportAdapter[];
  generatedAt?: string;
}): Promise<DocumentMigrationDryRun> {
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  if (!TIMESTAMP.test(generatedAt) || Number.isNaN(Date.parse(generatedAt))) {
    throw new DocumentMigrationError(
      "invalid_generated_at",
      "Migration plan 생성 시각은 timezone이 있는 유효한 timestamp여야 합니다.",
    );
  }
  const root = await canonicalRepositoryRoot(input.repositoryRoot);
  const sources = await scanDocumentSources({
    repositoryRoot: root,
    roots: input.roots,
    ...(input.excludePaths === undefined ? {} : { excludePaths: input.excludePaths }),
    ...(input.limits === undefined ? {} : { limits: input.limits }),
  });
  const imported = await importDocumentSources({
    sources,
    adapters: input.adapters ?? builtInDocumentImportAdapters,
  });
  const entries = await Promise.all(
    imported.artifacts.map((artifact) => candidatePlanEntry(root, artifact)),
  );
  entries.sort((left, right) => {
    const sourceOrder = compareText(left.sourcePath, right.sourcePath);
    return sourceOrder === 0
      ? compareText(left.candidateId, right.candidateId)
      : sourceOrder;
  });
  const summary = planWarnings(
    imported.artifacts,
    entries,
    new Set(sources.map((source) => source.path)),
  );
  const planContent = {
    schemaVersion: 1 as const,
    mode: "dry_run" as const,
    writesAllowed: false as const,
    approvalStatus: "not_requested" as const,
    outcome: summary.conflict
      ? "conflict" as const
      : summary.reviewRequired
        ? "review_required" as const
        : "ready_for_review" as const,
    sources: sources.map(({ path, contentHash, byteCount }) => ({ path, contentHash, byteCount })),
    candidates: entries,
    warnings: summary.warnings,
  };
  const plan: DocumentMigrationPlan = {
    ...planContent,
    planId: calculateMigrationPlanId(planContent),
    generatedAt,
  };
  if (!validateSchema("documentMigrationPlan", plan).valid) {
    throw new DocumentMigrationError(
      "invalid_migration_artifact",
      "Document migration dry-run plan을 schema-valid하게 만들 수 없습니다.",
    );
  }
  return {
    plan: structuredClone(plan),
    candidateArtifacts: imported.artifacts.map((artifact) => structuredClone(artifact)),
    candidateArtifactBytes: new Map(
      [...imported.bytesByArtifactId].map(([id, bytes]) => [id, new Uint8Array(bytes)]),
    ),
  };
}
