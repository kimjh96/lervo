import type {
  DocumentMigrationCandidate,
  DocumentMigrationPlan,
  DocumentStalenessResult,
  LegacyRegistryEntryArtifact,
  LegacyRegistryMigrationPlan,
  ManagedBlockPatchCandidate,
} from "@lervo/schemas";

import { canonicalJsonBytes, sha256 } from "./hash.js";

export function migrationCandidateBytes(
  candidate: DocumentMigrationCandidate,
): Uint8Array {
  return canonicalJsonBytes(candidate);
}

export function managedBlockPatchCandidateBytes(
  candidate: ManagedBlockPatchCandidate,
): Uint8Array {
  return canonicalJsonBytes(candidate);
}

export function calculateManagedBlockPatchCandidateId(
  candidate: Omit<ManagedBlockPatchCandidate, "candidateId"> | ManagedBlockPatchCandidate,
): string {
  const value = candidate as Partial<ManagedBlockPatchCandidate> & Record<string, unknown>;
  const { candidateId: _candidateId, ...content } = value;
  const digest = sha256(canonicalJsonBytes(content));
  return `mbpc_${digest.slice("sha256:".length, "sha256:".length + 16)}`;
}

export function calculateDocumentStalenessResultId(
  result: Omit<DocumentStalenessResult, "resultId"> | DocumentStalenessResult,
): string {
  const value = result as Partial<DocumentStalenessResult> & Record<string, unknown>;
  const { resultId: _resultId, ...content } = value;
  const digest = sha256(canonicalJsonBytes(content));
  return `dst_${digest.slice("sha256:".length, "sha256:".length + 16)}`;
}

export function calculateMigrationPlanId(
  plan: Omit<DocumentMigrationPlan, "planId" | "generatedAt"> | DocumentMigrationPlan,
): string {
  const value = plan as Partial<DocumentMigrationPlan> & Record<string, unknown>;
  const { planId: _planId, generatedAt: _generatedAt, ...content } = value;
  const digest = sha256(canonicalJsonBytes(content));
  return `migp_${digest.slice("sha256:".length, "sha256:".length + 16)}`;
}

export function legacyRegistryEntryBytes(
  artifact: Omit<LegacyRegistryEntryArtifact, "artifactId" | "contentHash" | "byteCount"> |
    LegacyRegistryEntryArtifact,
): Uint8Array {
  const value = artifact as Partial<LegacyRegistryEntryArtifact> & Record<string, unknown>;
  const {
    artifactId: _artifactId,
    contentHash: _contentHash,
    byteCount: _byteCount,
    ...content
  } = value;
  return canonicalJsonBytes(content);
}

export function calculateLegacyRegistryMigrationPlanId(
  plan: Omit<LegacyRegistryMigrationPlan, "planId" | "generatedAt"> |
    LegacyRegistryMigrationPlan,
): string {
  const value = plan as Partial<LegacyRegistryMigrationPlan> & Record<string, unknown>;
  const { planId: _planId, generatedAt: _generatedAt, ...content } = value;
  const digest = sha256(canonicalJsonBytes(content));
  return `migp_${digest.slice("sha256:".length, "sha256:".length + 16)}`;
}
