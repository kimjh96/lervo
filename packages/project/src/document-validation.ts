import { posix } from "node:path";

import type { DocumentManifest } from "@lervo/schemas";

import { LervoProjectError } from "./types.js";

function invalid(message: string): never {
  throw new LervoProjectError("contract_invalid", message);
}

function validateRepositoryPath(path: string, label: string): void {
  if (path === "." || path.endsWith("/") || path.includes("\\") || posix.normalize(path) !== path) {
    invalid(`${label} must be a normalized repository-relative path.`);
  }
}

export function validateDocumentManifest(manifest: DocumentManifest, fileName: string): void {
  if (fileName !== `${manifest.documentId}.yaml`) {
    invalid(`${fileName} does not match its documentId.`);
  }
  validateRepositoryPath(manifest.record.path, `${manifest.documentId} path`);
  for (const path of manifest.record.connectedPaths) {
    validateRepositoryPath(path, `${manifest.documentId} connectedPaths`);
  }
  if (manifest.record.ownership.mode === "lervo_generated") {
    validateRepositoryPath(
      manifest.record.ownership.manifestPath,
      `${manifest.documentId} generation manifestPath`,
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
    invalid(`${manifest.documentId} cannot reference itself in a document relation.`);
  }
  if (manifest.record.ownership.mode !== "managed_blocks") return;
  const blockIds = new Set<string>();
  const inputSourceIds = new Set<string>();
  for (const block of manifest.record.ownership.blocks) {
    if (blockIds.has(block.blockId)) {
      invalid(`${manifest.documentId} contains a duplicate managed block ID.`);
    }
    blockIds.add(block.blockId);
    if (
      block.startMarker !== `<!-- lervo:begin block=${block.blockId} schema=1 -->` ||
      block.endMarker !== `<!-- lervo:end block=${block.blockId} -->`
    ) {
      invalid(`${manifest.documentId} has a managed block marker in a nonstandard format.`);
    }
    for (const input of block.inputs) {
      if (inputSourceIds.has(input.sourceId)) {
        invalid(`${manifest.documentId} contains a duplicate managed block input source.`);
      }
      inputSourceIds.add(input.sourceId);
    }
  }
}

export function validateDocumentManifestSet(manifests: readonly DocumentManifest[]): void {
  const documentIds = new Set(manifests.map((manifest) => manifest.documentId));
  const paths = new Set<string>();
  for (const manifest of manifests) {
    if (paths.has(manifest.record.path)) {
      invalid(`Multiple document manifests own the same target path: ${manifest.record.path}`);
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
      invalid(`${manifest.documentId} references an unregistered document relation.`);
    }
  }
}
