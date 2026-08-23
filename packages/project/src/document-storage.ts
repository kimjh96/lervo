import { lstat, readdir } from "node:fs/promises";
import { basename, resolve } from "node:path";

import type {
  DocumentManifest,
  DocumentRecord,
  DocumentRegistry,
} from "@lervo/schemas";

import { parseAndValidateYaml } from "./config.js";
import {
  validateDocumentManifest,
  validateDocumentManifestSet,
} from "./document-validation.js";
import { readEntry } from "./filesystem.js";
import { resolveProjectPaths } from "./layout.js";
import { LervoProjectError } from "./types.js";

const MAX_DOCUMENT_MANIFEST_BYTES = 64 * 1024;
const MAX_DOCUMENT_MANIFESTS = 4096;
const DOCUMENT_FILE_PATTERN = /^doc_[A-Za-z0-9][A-Za-z0-9_-]{7,63}\.yaml$/;

function fail(code: "contract_invalid" | "document_layout_conflict", message: string): never {
  throw new LervoProjectError(code, message);
}

async function loadShardedManifests(path: string): Promise<DocumentManifest[]> {
  const before = await lstat(path, { bigint: true });
  if (!before.isDirectory() || before.isSymbolicLink()) {
    fail("document_layout_conflict", "The document manifest path must be a real directory.");
  }
  const entries = await readdir(path, { withFileTypes: true });
  if (entries.length > MAX_DOCUMENT_MANIFESTS) {
    fail("contract_invalid", "The document manifest count exceeds the safe per-project lookup limit.");
  }
  const manifests: DocumentManifest[] = [];
  for (const entry of entries.sort((left, right) =>
    left.name === right.name ? 0 : left.name < right.name ? -1 : 1
  )) {
    if (!entry.isFile() || entry.isSymbolicLink() || !DOCUMENT_FILE_PATTERN.test(entry.name)) {
      fail("document_layout_conflict", "The document manifest directory contains an entry outside the contract.");
    }
    const manifestEntry = await readEntry(resolve(path, entry.name), MAX_DOCUMENT_MANIFEST_BYTES);
    if (manifestEntry.kind !== "file") {
      fail("document_layout_conflict", `${entry.name} cannot be read safely as a document manifest.`);
    }
    const manifest = parseAndValidateYaml<DocumentManifest>(
      "documentManifest",
      manifestEntry.content,
    );
    validateDocumentManifest(manifest, basename(entry.name));
    manifests.push(manifest);
  }
  const after = await lstat(path, { bigint: true });
  if (
    !after.isDirectory() || after.isSymbolicLink() ||
    before.dev !== after.dev || before.ino !== after.ino ||
    before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs
  ) {
    fail("document_layout_conflict", "The document manifest directory changed while it was being read.");
  }
  validateDocumentManifestSet(manifests);
  return manifests;
}

async function documentStorageKind(root: string): Promise<{
  documents: Awaited<ReturnType<typeof readEntry>>;
  legacy: Awaited<ReturnType<typeof readEntry>>;
}> {
  const paths = resolveProjectPaths(root);
  const lervoRoot = await readEntry(paths.lervoRoot);
  if (lervoRoot.kind === "missing") {
    throw new LervoProjectError(
      "not_initialized",
      `${paths.lervoRoot} does not exist. Run lervo init first.`,
    );
  }
  if (lervoRoot.kind !== "directory") {
    throw new LervoProjectError(
      "unsafe_path",
      `${paths.lervoRoot} must be a real directory and cannot be a symbolic link.`,
    );
  }
  const migrationMarker = await readEntry(paths.documentMigrationMarker, 4096);
  if (migrationMarker.kind !== "missing") {
    throw new LervoProjectError(
      "document_layout_conflict",
      "The current layout cannot be read because the document registry migration is incomplete.",
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
    throw new LervoProjectError(
      "document_layout_conflict",
      "The legacy documents.yaml can be read, but it cannot be used with the per-document manifest API.",
    );
  }
  if (storage.documents.kind === "missing" && storage.legacy.kind === "missing") {
    return [];
  }
  fail("document_layout_conflict", "The document registry storage format is ambiguous.");
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
    return { schemaVersion: 1, documents: {} };
  }
  fail("document_layout_conflict", "The documents directory and legacy documents.yaml cannot be used together.");
}
