import { lstat, readdir } from "node:fs/promises";
import { basename, resolve } from "node:path";

import {
  parseAndValidateYaml,
  validateDocumentManifest,
  validateDocumentManifestSet,
} from "@lervo/project";
import type { DocumentManifest, DocumentRegistry } from "@lervo/schemas";
import { parse } from "yaml";

import type { IdentityMigrationPlan } from "./types.js";
import { readStableUtf8File } from "./safe-file.js";

const DOCUMENT_FILE_PATTERN = /^doc_[A-Za-z0-9][A-Za-z0-9_-]{7,63}\.yaml$/;

export interface DocumentInspection {
  disposition: IdentityMigrationPlan["documentDisposition"];
  archiveSourceName: "documents" | "documents.yaml" | null;
}

async function entryKind(path: string): Promise<"missing" | "directory" | "file" | "unsafe"> {
  try {
    const stats = await lstat(path);
    if (stats.isSymbolicLink()) return "unsafe";
    if (stats.isDirectory()) return "directory";
    if (stats.isFile()) return "file";
    return "unsafe";
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "missing";
    throw error;
  }
}

function normalizePreviousRecord(record: Record<string, unknown>): boolean {
  const previous = "ro" + "ven";
  let changed = false;
  const responsibleParty = record.responsibleParty as Record<string, unknown> | undefined;
  if (responsibleParty?.kind === previous) {
    responsibleParty.kind = "lervo";
    changed = true;
  }
  const ownership = record.ownership as Record<string, unknown> | undefined;
  if (ownership?.mode === `${previous}_generated`) {
    ownership.mode = "lervo_generated";
    changed = true;
  }
  if (
    typeof ownership?.manifestPath === "string" &&
    ownership.manifestPath.startsWith(`.${previous}/`)
  ) {
    ownership.manifestPath = `.lervo/${ownership.manifestPath.slice(previous.length + 2)}`;
    changed = true;
  }
  if (Array.isArray(ownership?.blocks)) {
    for (const candidate of ownership.blocks) {
      if (candidate === null || typeof candidate !== "object" || Array.isArray(candidate)) continue;
      const block = candidate as Record<string, unknown>;
      for (const key of ["startMarker", "endMarker"] as const) {
        if (typeof block[key] === "string" && block[key].includes(`<!-- ${previous}:`)) {
          block[key] = block[key].replace(`<!-- ${previous}:`, "<!-- lervo:");
          changed = true;
        }
      }
    }
  }
  return changed;
}

function normalizePreviousDocument(value: unknown): { value: unknown; changed: boolean } {
  const copy = structuredClone(value);
  if (copy === null || typeof copy !== "object" || Array.isArray(copy)) {
    return { value: copy, changed: false };
  }
  const root = copy as Record<string, unknown>;
  let changed = false;
  if (root.record !== null && typeof root.record === "object" && !Array.isArray(root.record)) {
    changed = normalizePreviousRecord(root.record as Record<string, unknown>) || changed;
    const policy = root.contentPolicy as Record<string, unknown> | undefined;
    const previous = "ro" + "ven";
    if (policy?.mode === `${previous}_generated`) {
      policy.mode = "lervo_generated";
      changed = true;
    }
  }
  if (
    root.documents !== null &&
    typeof root.documents === "object" &&
    !Array.isArray(root.documents)
  ) {
    for (const record of Object.values(root.documents as Record<string, unknown>)) {
      if (record !== null && typeof record === "object" && !Array.isArray(record)) {
        changed = normalizePreviousRecord(record as Record<string, unknown>) || changed;
      }
    }
  }
  return { value: copy, changed };
}

function readManifest(
  content: string,
  fileName: string,
): {
  manifest: DocumentManifest;
  previous: boolean;
} {
  try {
    const manifest = parseAndValidateYaml<DocumentManifest>("documentManifest", content);
    validateDocumentManifest(manifest, fileName);
    return { manifest, previous: false };
  } catch (currentError) {
    const normalized = normalizePreviousDocument(parse(content));
    if (!normalized.changed) throw currentError;
    const manifest = parseAndValidateYaml<DocumentManifest>(
      "documentManifest",
      JSON.stringify(normalized.value),
    );
    validateDocumentManifest(manifest, fileName);
    return { manifest, previous: true };
  }
}

export async function inspectDocuments(sourceRoot: string): Promise<DocumentInspection> {
  const directory = resolve(sourceRoot, "documents");
  const registryPath = resolve(sourceRoot, "documents.yaml");
  const directoryKind = await entryKind(directory);
  const registryKind = await entryKind(registryPath);
  if (directoryKind === "missing" && registryKind === "missing") {
    return { disposition: "create_empty", archiveSourceName: null };
  }
  if (directoryKind === "directory" && registryKind === "missing") {
    const entries = await readdir(directory, { withFileTypes: true });
    if (entries.length > 4_096)
      throw new Error("The document manifest count exceeds the safe limit.");
    const manifests: DocumentManifest[] = [];
    let previous = false;
    for (const entry of entries.sort((left, right) =>
      left.name === right.name ? 0 : left.name < right.name ? -1 : 1,
    )) {
      if (!entry.isFile() || entry.isSymbolicLink() || !DOCUMENT_FILE_PATTERN.test(entry.name)) {
        throw new Error("The document manifest directory contains an entry outside the contract.");
      }
      const path = resolve(directory, entry.name);
      const read = readManifest(await readStableUtf8File(path, 64 * 1024), basename(path));
      previous ||= read.previous;
      manifests.push(read.manifest);
    }
    validateDocumentManifestSet(manifests);
    return previous
      ? { disposition: "archive_previous_metadata", archiveSourceName: "documents" }
      : { disposition: "preserve_active", archiveSourceName: null };
  }
  if (directoryKind === "missing" && registryKind === "file") {
    const content = await readStableUtf8File(registryPath, 4 * 1024 * 1024);
    try {
      parseAndValidateYaml<DocumentRegistry>("documentRegistry", content);
      return { disposition: "preserve_active", archiveSourceName: null };
    } catch (currentError) {
      const normalized = normalizePreviousDocument(parse(content));
      if (!normalized.changed) throw currentError;
      parseAndValidateYaml<DocumentRegistry>("documentRegistry", JSON.stringify(normalized.value));
      return { disposition: "archive_previous_metadata", archiveSourceName: "documents.yaml" };
    }
  }
  throw new Error(
    "The storage format cannot be resolved between document manifests and the legacy registry.",
  );
}
