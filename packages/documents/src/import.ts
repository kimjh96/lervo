import {
  validateSchema,
  type DocumentMigrationCandidate,
  type DocumentMigrationCandidateArtifact,
} from "@lervo/schemas";

import { normalizeScanPath } from "./filesystem.js";
import { digestSuffix, sha256 } from "./hash.js";
import { migrationCandidateBytes } from "./integrity.js";
import {
  DocumentMigrationError,
  type DocumentImportAdapter,
  type DocumentImportDraft,
  type ScannedDocumentSource,
} from "./types.js";

const ADAPTER_ID = /^[a-z][a-z0-9_]{0,63}$/;
const ADAPTER_VERSION = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/;
const MAX_MIGRATION_CANDIDATES = 4096;

function compareText(left: string, right: string): number {
  return left === right ? 0 : left < right ? -1 : 1;
}

function validateAdapters(adapters: readonly DocumentImportAdapter[]): void {
  const ids = new Set<string>();
  for (const adapter of adapters) {
    const { adapterId, version } = adapter.descriptor;
    if (!ADAPTER_ID.test(adapterId) || !ADAPTER_VERSION.test(version) || ids.has(adapterId)) {
      throw new DocumentMigrationError(
        "invalid_adapter_contract",
        "Document import adapter descriptor가 공통 계약을 통과하지 못했습니다.",
      );
    }
    ids.add(adapterId);
  }
}

function unknownDraft(): DocumentImportDraft {
  return {
    formatId: "unknown",
    disposition: "observed",
    confidence: "none",
    detectedOwnership: "unknown",
    proposal: null,
    warnings: ["unsupported_format"],
  };
}

function candidateFromDraft(
  source: ScannedDocumentSource,
  draft: DocumentImportDraft,
  index: number,
  importer: { adapterId: string; version: string },
): DocumentMigrationCandidate {
  if (
    (draft.proposal === null && (
      draft.disposition !== "observed" || draft.detectedOwnership !== "unknown"
    )) ||
    (draft.disposition === "ready_for_approval" && (
      draft.proposal === null || draft.confidence === "low" || draft.confidence === "none"
    ))
  ) {
    throw new DocumentMigrationError(
      "invalid_adapter_contract",
      "Document import adapter의 처분, 신뢰도와 문서 제안이 서로 맞지 않습니다.",
    );
  }
  if (draft.proposal !== null) {
    try {
      const normalized = normalizeScanPath(draft.proposal.documentPath);
      if (normalized === ".") throw new Error("document path cannot be repository root");
    } catch (error) {
      throw new DocumentMigrationError(
        "invalid_adapter_contract",
        "Document import adapter가 정규화되지 않은 문서 경로를 제안했습니다.",
        { cause: error },
      );
    }
  }
  const locator = draft.locator ?? `candidate-${index}`;
  const candidate: DocumentMigrationCandidate = {
    schemaVersion: 1,
    candidateId: `migc_${digestSuffix(
      `${source.path}\0${source.contentHash}\0${locator}`,
    )}`,
    importer,
    source: {
      path: source.path,
      contentHash: source.contentHash,
      byteCount: source.byteCount,
      formatId: draft.formatId,
      ...(draft.locator === undefined ? {} : { locator: draft.locator }),
    },
    disposition: draft.disposition,
    confidence: draft.confidence,
    detectedOwnership: draft.detectedOwnership,
    proposal: draft.proposal === null
      ? null
      : {
          documentId: draft.proposal.documentId,
          documentPath: draft.proposal.documentPath,
          profileId: draft.proposal.profileId,
          relations: {
            supersedesDocumentIds: [...draft.proposal.relations.supersedesDocumentIds]
              .sort(compareText),
            relatedDocumentIds: [...draft.proposal.relations.relatedDocumentIds]
              .sort(compareText),
          },
        },
    warnings: [...new Set(draft.warnings)].sort(compareText),
  };
  if (!validateSchema("documentMigrationCandidate", candidate).valid) {
    throw new DocumentMigrationError(
      "invalid_adapter_contract",
      "Document import adapter 결과가 migration candidate 계약을 통과하지 못했습니다.",
    );
  }
  return candidate;
}

function materializeCandidate(
  candidate: DocumentMigrationCandidate,
): { artifact: DocumentMigrationCandidateArtifact; bytes: Uint8Array } {
  const bytes = migrationCandidateBytes(candidate);
  const contentHash = sha256(bytes);
  const artifact: DocumentMigrationCandidateArtifact = {
    schemaVersion: 1,
    artifactId: `art_${contentHash.slice("sha256:".length, "sha256:".length + 16)}`,
    contentHash,
    byteCount: bytes.byteLength,
    candidate,
  };
  if (!validateSchema("documentMigrationCandidateArtifact", artifact).valid) {
    throw new DocumentMigrationError(
      "invalid_migration_artifact",
      "Migration candidate artifact를 schema-valid하게 만들 수 없습니다.",
    );
  }
  return { artifact, bytes };
}

export async function importDocumentSources(input: {
  sources: readonly ScannedDocumentSource[];
  adapters: readonly DocumentImportAdapter[];
}): Promise<{
  artifacts: readonly DocumentMigrationCandidateArtifact[];
  bytesByArtifactId: ReadonlyMap<string, Uint8Array>;
}> {
  validateAdapters(input.adapters);
  const adapters = [...input.adapters].sort((left, right) =>
    compareText(left.descriptor.adapterId, right.descriptor.adapterId)
  );
  const materialized: Array<{
    artifact: DocumentMigrationCandidateArtifact;
    bytes: Uint8Array;
  }> = [];
  const candidateIds = new Set<string>();
  for (const source of input.sources) {
    let matching: DocumentImportAdapter[];
    try {
      matching = adapters.filter((adapter) => adapter.supports(source.path));
    } catch (error) {
      throw new DocumentMigrationError(
        "invalid_adapter_contract",
        "Document import adapter가 source 지원 여부를 판정하지 못했습니다.",
        { cause: error },
      );
    }
    if (matching.length > 1) {
      throw new DocumentMigrationError(
        "ambiguous_import_adapter",
        `여러 document import adapter가 같은 source를 선택했습니다: ${source.path}`,
      );
    }
    const adapter = matching[0];
    let drafts: readonly DocumentImportDraft[];
    let importer: { adapterId: string; version: string };
    if (adapter === undefined) {
      drafts = [unknownDraft()];
      importer = { adapterId: "lervo_unknown", version: "1.0.0" };
    } else {
      const adapterBytes = new Uint8Array(source.bytes);
      try {
        drafts = await adapter.inspect({
          path: source.path,
          contentHash: source.contentHash,
          byteCount: source.byteCount,
          bytes: adapterBytes,
        });
      } catch (error) {
        throw new DocumentMigrationError(
          "invalid_adapter_contract",
          "Document import adapter가 source를 판정하지 못했습니다.",
          { cause: error },
        );
      }
      importer = { ...adapter.descriptor };
      if (
        sha256(adapterBytes) !== source.contentHash || drafts.length === 0 ||
        drafts.length > MAX_MIGRATION_CANDIDATES
      ) {
        throw new DocumentMigrationError(
          "invalid_adapter_contract",
          "Document import adapter가 입력 bytes를 바꾸거나 후보 수 계약을 어겼습니다.",
        );
      }
    }
    for (const [index, draft] of drafts.entries()) {
      const item = materializeCandidate(candidateFromDraft(source, draft, index, importer));
      if (candidateIds.has(item.artifact.candidate.candidateId)) {
        throw new DocumentMigrationError(
          "invalid_adapter_contract",
          "Document import adapter가 중복 candidate 좌표를 반환했습니다.",
        );
      }
      candidateIds.add(item.artifact.candidate.candidateId);
      materialized.push(item);
      if (materialized.length > MAX_MIGRATION_CANDIDATES) {
        throw new DocumentMigrationError(
          "scan_limit_exceeded",
          "Document migration candidate 수 제한을 넘었습니다.",
        );
      }
    }
  }
  materialized.sort((left, right) => {
    const pathOrder = compareText(
      left.artifact.candidate.source.path,
      right.artifact.candidate.source.path,
    );
    return pathOrder === 0
      ? compareText(left.artifact.candidate.candidateId, right.artifact.candidate.candidateId)
      : pathOrder;
  });
  const bytesByArtifactId = new Map<string, Uint8Array>();
  for (const item of materialized) {
    const existing = bytesByArtifactId.get(item.artifact.artifactId);
    if (existing !== undefined && sha256(existing) !== item.artifact.contentHash) {
      throw new DocumentMigrationError(
        "invalid_migration_artifact",
        "서로 다른 migration candidate가 같은 artifact ID를 사용합니다.",
      );
    }
    bytesByArtifactId.set(item.artifact.artifactId, new Uint8Array(item.bytes));
  }
  return {
    artifacts: materialized.map((item) => structuredClone(item.artifact)),
    bytesByArtifactId,
  };
}
