import { posix } from "node:path";

import type { DocumentManifest } from "@lervo/schemas";

import { LervoProjectError } from "./types.js";

function invalid(message: string): never {
  throw new LervoProjectError("contract_invalid", message);
}

function validateRepositoryPath(path: string, label: string): void {
  if (
    path === "." ||
    path.endsWith("/") ||
    path.includes("\\") ||
    posix.normalize(path) !== path
  ) {
    invalid(`${label}은 정규화된 저장소 상대 경로여야 합니다.`);
  }
}

export function validateDocumentManifest(
  manifest: DocumentManifest,
  fileName: string,
): void {
  if (fileName !== `${manifest.documentId}.yaml`) {
    invalid(`${fileName}의 파일명과 documentId가 다릅니다.`);
  }
  validateRepositoryPath(manifest.record.path, `${manifest.documentId}의 path`);
  for (const path of manifest.record.connectedPaths) {
    validateRepositoryPath(path, `${manifest.documentId}의 connectedPaths`);
  }
  if (manifest.record.ownership.mode === "lervo_generated") {
    validateRepositoryPath(
      manifest.record.ownership.manifestPath,
      `${manifest.documentId}의 generation manifestPath`,
    );
  }
  const relationIds = [
    ...(manifest.relations.parentDocumentId === undefined
      ? []
      : [manifest.relations.parentDocumentId]),
    ...manifest.relations.supersedesDocumentIds,
    ...manifest.relations.relatedDocumentIds,
  ];
  if (relationIds.includes(manifest.documentId)) {
    invalid(`${manifest.documentId}은 자기 자신을 문서 관계로 가리킬 수 없습니다.`);
  }
  if (manifest.record.ownership.mode !== "managed_blocks") return;
  const blockIds = new Set<string>();
  const inputSourceIds = new Set<string>();
  for (const block of manifest.record.ownership.blocks) {
    if (blockIds.has(block.blockId)) {
      invalid(`${manifest.documentId}에 중복된 managed block ID가 있습니다.`);
    }
    blockIds.add(block.blockId);
    if (
      block.startMarker !== `<!-- lervo:begin block=${block.blockId} schema=1 -->` ||
      block.endMarker !== `<!-- lervo:end block=${block.blockId} -->`
    ) {
      invalid(`${manifest.documentId}의 managed block marker가 표준 형식이 아닙니다.`);
    }
    for (const input of block.inputs) {
      if (inputSourceIds.has(input.sourceId)) {
        invalid(`${manifest.documentId}의 managed block 입력 source가 중복됩니다.`);
      }
      inputSourceIds.add(input.sourceId);
    }
  }
}

export function validateDocumentManifestSet(
  manifests: readonly DocumentManifest[],
): void {
  const documentIds = new Set(manifests.map((manifest) => manifest.documentId));
  const paths = new Set<string>();
  for (const manifest of manifests) {
    if (paths.has(manifest.record.path)) {
      invalid(`여러 document manifest가 같은 대상 경로를 소유합니다: ${manifest.record.path}`);
    }
    paths.add(manifest.record.path);
    const relationIds = [
      ...(manifest.relations.parentDocumentId === undefined
        ? []
        : [manifest.relations.parentDocumentId]),
      ...manifest.relations.supersedesDocumentIds,
      ...manifest.relations.relatedDocumentIds,
    ];
    if (relationIds.some((documentId) => !documentIds.has(documentId))) {
      invalid(`${manifest.documentId}가 등록되지 않은 문서 관계를 가리킵니다.`);
    }
  }
}
