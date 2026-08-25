import { posix } from "node:path";

import type { DocumentRegistry } from "@lervo/schemas";

import { digestSuffix } from "./hash.js";
import { parseLegacyDocumentRegistry } from "./legacy-registry.js";
import { parseManagedMarkdownBlocks } from "./managed-block-parser.js";
import type { DocumentImportAdapter, DocumentImportDraft, DocumentImportSource } from "./types.js";

function documentId(path: string): string {
  return `doc_${digestSuffix(`document-path\0${path}`)}`;
}

function markdownProposal(source: DocumentImportSource, formatId: "markdown" | "mdx") {
  return {
    documentId: documentId(source.path),
    documentPath: source.path,
    profileId: formatId === "mdx" ? "imported-mdx/v1" : "imported-markdown/v1",
    relations: { supersedesDocumentIds: [], relatedDocumentIds: [] },
  };
}

function mdxDraft(source: DocumentImportSource): DocumentImportDraft {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(source.bytes);
  } catch {
    return {
      formatId: "mdx",
      disposition: "observed",
      confidence: "none",
      detectedOwnership: "unknown",
      proposal: null,
      warnings: ["invalid_utf8"],
    };
  }
  const previousProductPrefix = "ro" + "ven";
  const containsMarker =
    text.includes("<!-- lervo:") || text.includes(`<!-- ${previousProductPrefix}:`);
  const warnings = ["profile_requires_review", "mdx_semantics_not_parsed"];
  if (source.byteCount >= 32768) warnings.push("split_recommended");
  if (containsMarker) warnings.push("marker_structure_not_verified");
  return {
    formatId: "mdx",
    disposition: "review_required",
    confidence: containsMarker ? "none" : "medium",
    detectedOwnership: containsMarker ? "unknown" : "user",
    proposal: markdownProposal(source, "mdx"),
    warnings,
  };
}

function markdownDraft(source: DocumentImportSource): DocumentImportDraft {
  const parsed = parseManagedMarkdownBlocks(source.bytes);
  if (parsed.diagnostics.some((diagnostic) => diagnostic.code === "invalid_utf8")) {
    return {
      formatId: "markdown",
      disposition: "observed",
      confidence: "none",
      detectedOwnership: "unknown",
      proposal: null,
      warnings: ["invalid_utf8"],
    };
  }

  const warnings = ["profile_requires_review"];
  if (source.byteCount >= 32768) warnings.push("split_recommended");
  if (parsed.ignoredMarkers.length > 0) warnings.push("marker_candidates_in_code_ignored");
  if (parsed.status === "invalid") {
    warnings.push("managed_block_structure_invalid");
    warnings.push(...parsed.diagnostics.map((diagnostic) => diagnostic.code));
    return {
      formatId: "markdown",
      disposition: "review_required",
      confidence: "none",
      detectedOwnership: "unknown",
      proposal: markdownProposal(source, "markdown"),
      warnings,
    };
  }

  const hasManagedBlocks = parsed.blocks.length > 0;
  const hasPreviousMarkers = parsed.blocks.some(
    (block) => block.markerFamily === "previous_product_v1",
  );
  if (hasPreviousMarkers) warnings.push("legacy_marker_requires_migration");
  return {
    formatId: "markdown",
    disposition: "review_required",
    confidence: hasPreviousMarkers ? "low" : hasManagedBlocks ? "high" : "medium",
    detectedOwnership: hasManagedBlocks ? "managed_blocks" : "user",
    proposal: markdownProposal(source, "markdown"),
    warnings,
  };
}

export const markdownImportAdapter: DocumentImportAdapter = {
  descriptor: { adapterId: "markdown", version: "1.1.0" },
  supports(path) {
    const extension = posix.extname(path).toLowerCase();
    return extension === ".md" || extension === ".mdx";
  },
  inspect(source) {
    return [
      posix.extname(source.path).toLowerCase() === ".mdx"
        ? mdxDraft(source)
        : markdownDraft(source),
    ];
  },
};

function invalidLegacyDraft(warning: string, locator?: string): DocumentImportDraft {
  return {
    formatId: "lervo_legacy_registry",
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
    record.path === "." ||
    record.path.endsWith("/") ||
    record.path.includes("\\") ||
    posix.normalize(record.path) !== record.path
  ) {
    return invalidLegacyDraft("invalid_legacy_registry_layout", documentIdValue);
  }
  return {
    formatId: "lervo_legacy_registry",
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
  descriptor: { adapterId: "lervo_legacy_registry", version: "1.0.0" },
  supports(path) {
    return path === ".lervo/documents.yaml";
  },
  inspect(source) {
    const registry = parseLegacyDocumentRegistry(source.bytes);
    if (registry === null) {
      return [invalidLegacyDraft("invalid_legacy_registry")];
    }
    const ids = Object.keys(registry.documents).sort();
    if (ids.length === 0) return [invalidLegacyDraft("empty_legacy_registry")];
    return ids.map((id) => legacyDraft(source, id, registry));
  },
};

export const builtInDocumentImportAdapters: readonly DocumentImportAdapter[] = [
  legacyRegistryImportAdapter,
  markdownImportAdapter,
];
