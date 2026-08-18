import { readdir } from "node:fs/promises";
import { basename, resolve } from "node:path";

import type {
  DocumentManifest,
  DocumentRecord,
  DocumentRegistry,
} from "@roven/schemas";

import { parseAndValidateYaml } from "./config.js";
import {
  validateDocumentManifest,
  validateDocumentManifestSet,
} from "./document-validation.js";
import { readEntry } from "./filesystem.js";
import { resolveProjectPaths } from "./layout.js";
import { RovenProjectError } from "./types.js";

const MAX_DOCUMENT_MANIFEST_BYTES = 64 * 1024;
const MAX_DOCUMENT_MANIFESTS = 4096;
const DOCUMENT_FILE_PATTERN = /^doc_[A-Za-z0-9][A-Za-z0-9_-]{7,63}\.yaml$/;

function fail(code: "contract_invalid" | "document_layout_conflict", message: string): never {
  throw new RovenProjectError(code, message);
}

async function loadShardedManifests(path: string): Promise<DocumentManifest[]> {
  const entries = await readdir(path, { withFileTypes: true });
  if (entries.length > MAX_DOCUMENT_MANIFESTS) {
    fail("contract_invalid", "문서 manifest 수가 한 프로젝트의 안전한 조회 한도를 넘었습니다.");
  }
  const manifests: DocumentManifest[] = [];
  for (const entry of entries.sort((left, right) =>
    left.name === right.name ? 0 : left.name < right.name ? -1 : 1
  )) {
    if (!entry.isFile() || entry.isSymbolicLink() || !DOCUMENT_FILE_PATTERN.test(entry.name)) {
      fail("document_layout_conflict", "문서 manifest 디렉터리에 계약 밖의 항목이 있습니다.");
    }
    const manifestEntry = await readEntry(resolve(path, entry.name), MAX_DOCUMENT_MANIFEST_BYTES);
    if (manifestEntry.kind !== "file") {
      fail("document_layout_conflict", `${entry.name}을 안전한 document manifest로 읽을 수 없습니다.`);
    }
    const manifest = parseAndValidateYaml<DocumentManifest>(
      "documentManifest",
      manifestEntry.content,
    );
    validateDocumentManifest(manifest, basename(entry.name));
    manifests.push(manifest);
  }
  validateDocumentManifestSet(manifests);
  return manifests;
}

async function documentStorageKind(root: string): Promise<{
  documents: Awaited<ReturnType<typeof readEntry>>;
  legacy: Awaited<ReturnType<typeof readEntry>>;
}> {
  const paths = resolveProjectPaths(root);
  const rovenRoot = await readEntry(paths.rovenRoot);
  if (rovenRoot.kind === "missing") {
    throw new RovenProjectError(
      "not_initialized",
      `${paths.rovenRoot}이 없습니다. 먼저 roven init을 실행하세요.`,
    );
  }
  if (rovenRoot.kind !== "directory") {
    throw new RovenProjectError(
      "unsafe_path",
      `${paths.rovenRoot}은 실제 디렉터리여야 하며 심볼릭 링크일 수 없습니다.`,
    );
  }
  return {
    documents: await readEntry(paths.documents),
    legacy: await readEntry(paths.legacyDocumentRegistry),
  };
}

export async function loadDocumentManifests(root: string): Promise<DocumentManifest[]> {
  const paths = resolveProjectPaths(root);
  const storage = await documentStorageKind(root);
  if (storage.documents.kind === "directory" && storage.legacy.kind === "missing") {
    return loadShardedManifests(paths.documents);
  }
  if (storage.documents.kind === "missing" && storage.legacy.kind === "file") {
    throw new RovenProjectError(
      "document_layout_conflict",
      "기존 documents.yaml은 읽을 수 있지만 문서별 manifest API에는 사용할 수 없습니다.",
    );
  }
  if (storage.documents.kind === "missing" && storage.legacy.kind === "missing") {
    throw new RovenProjectError(
      "not_initialized",
      `${paths.documents}이 없습니다. 먼저 roven init을 실행하세요.`,
    );
  }
  fail("document_layout_conflict", "문서 registry 저장 형식이 하나로 결정되지 않습니다.");
}

export async function loadDocumentRegistry(root: string): Promise<DocumentRegistry> {
  const paths = resolveProjectPaths(root);
  const storage = await documentStorageKind(root);
  if (storage.documents.kind === "directory" && storage.legacy.kind === "missing") {
    const manifests = await loadShardedManifests(paths.documents);
    const documents: Record<string, DocumentRecord> = {};
    for (const manifest of manifests) documents[manifest.documentId] = manifest.record;
    return { schemaVersion: 1, documents };
  }
  if (storage.documents.kind === "missing" && storage.legacy.kind === "file") {
    return parseAndValidateYaml<DocumentRegistry>("documentRegistry", storage.legacy.content);
  }
  if (storage.documents.kind === "missing" && storage.legacy.kind === "missing") {
    throw new RovenProjectError(
      "not_initialized",
      `${paths.documents}이 없습니다. 먼저 roven init을 실행하세요.`,
    );
  }
  fail("document_layout_conflict", "documents 디렉터리와 기존 documents.yaml을 함께 사용할 수 없습니다.");
}
