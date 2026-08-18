import { posix } from "node:path";

import { validateSchema, type DocumentRegistry } from "@roven/schemas";
import { parse } from "yaml";

import { digestSuffix } from "./hash.js";
import type {
  DocumentImportAdapter,
  DocumentImportDraft,
  DocumentImportSource,
} from "./types.js";

function documentId(path: string): string {
  return `doc_${digestSuffix(`document-path\0${path}`)}`;
}

function markdownDraft(source: DocumentImportSource): DocumentImportDraft {
  const extension = posix.extname(source.path).toLowerCase();
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(source.bytes);
  } catch {
    return {
      formatId: extension === ".mdx" ? "mdx" : "markdown",
      disposition: "observed",
      confidence: "none",
      detectedOwnership: "unknown",
      proposal: null,
      warnings: ["invalid_utf8"],
    };
  }
  const containsRovenMarker = text.includes("<!-- roven:");
  const warnings = ["profile_requires_review"];
  if (extension === ".mdx") warnings.push("mdx_semantics_not_parsed");
  if (source.byteCount >= 32768) warnings.push("split_recommended");
  if (containsRovenMarker) warnings.push("marker_structure_not_verified");
  return {
    formatId: extension === ".mdx" ? "mdx" : "markdown",
    disposition: "review_required",
    confidence: containsRovenMarker ? "low" : "medium",
    detectedOwnership: containsRovenMarker ? "managed_blocks" : "user",
    proposal: {
      documentId: documentId(source.path),
      documentPath: source.path,
      profileId: extension === ".mdx" ? "imported-mdx/v1" : "imported-markdown/v1",
      relations: { supersedesDocumentIds: [], relatedDocumentIds: [] },
    },
    warnings,
  };
}

export const markdownImportAdapter: DocumentImportAdapter = {
  descriptor: { adapterId: "markdown", version: "1.0.0" },
  supports(path) {
    const extension = posix.extname(path).toLowerCase();
    return extension === ".md" || extension === ".mdx";
  },
  inspect(source) {
    return [markdownDraft(source)];
  },
};

function invalidLegacyDraft(warning: string, locator?: string): DocumentImportDraft {
  return {
    formatId: "roven_legacy_registry",
    ...(locator === undefined ? {} : { locator }),
    disposition: "observed",
    confidence: "none",
    detectedOwnership: "unknown",
    proposal: null,
    warnings: [warning],
  };
}

function legacyDraft(
  source: DocumentImportSource,
  documentIdValue: string,
  registry: DocumentRegistry,
): DocumentImportDraft {
  const record = registry.documents[documentIdValue];
  if (record === undefined) return invalidLegacyDraft("invalid_legacy_registry");
  if (
    record.path === "." || record.path.endsWith("/") || record.path.includes("\\") ||
    posix.normalize(record.path) !== record.path
  ) {
    return invalidLegacyDraft("invalid_legacy_registry_layout", documentIdValue);
  }
  return {
    formatId: "roven_legacy_registry",
    locator: documentIdValue,
    disposition: "review_required",
    confidence: "high",
    detectedOwnership: record.ownership.mode,
    proposal: {
      documentId: documentIdValue,
      documentPath: record.path,
      profileId: "legacy-document/v1",
      relations: { supersedesDocumentIds: [], relatedDocumentIds: [] },
    },
    warnings: ["legacy_registry_requires_split", "profile_requires_review"],
  };
}

export const legacyRegistryImportAdapter: DocumentImportAdapter = {
  descriptor: { adapterId: "roven_legacy_registry", version: "1.0.0" },
  supports(path) {
    return path === ".roven/documents.yaml";
  },
  inspect(source) {
    let value: unknown;
    try {
      const text = new TextDecoder("utf-8", { fatal: true }).decode(source.bytes);
      value = parse(text);
    } catch {
      return [invalidLegacyDraft("invalid_legacy_registry")];
    }
    if (!validateSchema("documentRegistry", value).valid) {
      return [invalidLegacyDraft("invalid_legacy_registry")];
    }
    const registry = value as DocumentRegistry;
    const ids = Object.keys(registry.documents).sort();
    if (ids.length === 0) return [invalidLegacyDraft("empty_legacy_registry")];
    return ids.map((id) => legacyDraft(source, id, registry));
  },
};

export const builtInDocumentImportAdapters: readonly DocumentImportAdapter[] = [
  legacyRegistryImportAdapter,
  markdownImportAdapter,
];
