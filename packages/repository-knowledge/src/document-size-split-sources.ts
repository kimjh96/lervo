// ADR-0653: what a document size split reads besides the scan: documents the scanner left out for
// their size, and the concept registry's digests around the split.
import { lstat, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { loadDecisionTaxonomy } from "@lervo/project";
import { parse } from "yaml";

import type { scanCompleteConfiguredRepositoryKnowledge } from "./compiler.js";
import { bytePreservedDocumentCollection } from "./document-layout.js";
import { DOCUMENT_SIZE_SPLIT_MAXIMUM_BYTES } from "./document-size-split-layout.js";
import { safeHash } from "./document-structure-split.js";
import { canonicalJson, sha256 } from "./integrity.js";
import { repositoryPathMatchesPatterns } from "./knowledge-intake-policy.js";
import { isWithinPublicationRoot } from "./repository-publication-files.js";
import type { loadStoredConcepts } from "./store-reader.js";
import { structuralConceptDirectory } from "./structural-projection.js";
import type { KnowledgeFileOperation, RepositoryKnowledgeScan, RepositorySource } from "./types.js";

export type ScannedPolicy = Awaited<
  ReturnType<typeof scanCompleteConfiguredRepositoryKnowledge>
>["policy"];
/** A document to split; `unread` when the scanner left it out for its size, so it has no lineage. */
export type SplitSource = RepositorySource & {
  content: string;
  contentHash: string;
  unread: boolean;
  /** Bytes Lervo keeps whole as data: over the split maximum, or not UTF-8 text. */
  data: boolean;
};

/**
 * Markdown documents the scanner left out because they exceed the policy's file size, which a
 * split brings into knowledge. They are read directly, up to the split maximum; a larger one is
 * returned without content, as data.
 */
export async function unreadDocuments(
  root: string,
  scan: RepositoryKnowledgeScan,
  policy: ScannedPolicy,
  generatedPaths: ReadonlySet<string>,
  requested: readonly SplitSource[],
): Promise<SplitSource[]> {
  const taxonomy = await loadDecisionTaxonomy(root);
  const documents: SplitSource[] = [];
  for (const source of scan.sources) {
    if (
      source.status !== "unsupported" ||
      source.reason !== "file_size_limit" ||
      source.kind !== "documentation" ||
      !source.path.endsWith(".md") ||
      requested.some((item) => item.path === source.path) ||
      generatedPaths.has(source.path) ||
      isWithinPublicationRoot(source.path, policy.publicationRoot) ||
      bytePreservedDocumentCollection(source.path, taxonomy) ||
      repositoryPathMatchesPatterns(source.path, policy.normalization?.exclude ?? [])
    )
      continue;
    const absolute = resolve(root, source.path);
    const stats = await lstat(absolute);
    if (!stats.isFile() || stats.isSymbolicLink()) continue;
    let content = "";
    if (stats.size <= DOCUMENT_SIZE_SPLIT_MAXIMUM_BYTES) {
      const bytes = await readFile(absolute);
      try {
        content = new TextDecoder("utf8", { fatal: true, ignoreBOM: true }).decode(bytes);
      } catch {
        // Bytes that are not UTF-8 cannot be split as text; they stay whole, as data.
      }
    }
    documents.push({
      ...source,
      byteCount: stats.size,
      content,
      contentHash: sha256(content),
      unread: true,
      data: content.length === 0,
    });
  }
  return documents;
}

/** The concept registry's digest before and after, and the concepts the refresh touches. */
export async function registryChange(
  root: string,
  storedConcepts: Awaited<ReturnType<typeof loadStoredConcepts>>,
  structural: ReadonlyArray<KnowledgeFileOperation>,
): Promise<{
  registryDigest: string;
  afterRegistryDigest: string;
  created: string[];
  updated: string[];
  deprecated: string[];
}> {
  const materials = (
    await Promise.all(
      storedConcepts.map(async (item) => ({
        file: item.file,
        contentHash: await safeHash(resolve(root, item.file)),
      })),
    )
  ).sort((left, right) => left.file.localeCompare(right.file));
  const concepts = structural.filter(
    (operation) =>
      operation.path.startsWith(`${structuralConceptDirectory}/`) &&
      operation.action !== "conflict",
  );
  const after = new Map(materials.map((item) => [item.file, item.contentHash]));
  for (const item of concepts) after.set(item.path, item.desiredHash);
  const idOf = (path: string): string => path.slice(path.lastIndexOf("/") + 1, -".yaml".length);
  const deprecated = concepts
    .filter(
      (item) =>
        item.content !== undefined &&
        (parse(item.content) as { publicationStatus?: unknown }).publicationStatus === "deprecated",
    )
    .map((item) => idOf(item.path))
    .sort();
  return {
    registryDigest: sha256(canonicalJson(materials)),
    afterRegistryDigest: sha256(
      canonicalJson(
        [...after]
          .map(([file, contentHash]) => ({ file, contentHash }))
          .sort((left, right) => left.file.localeCompare(right.file)),
      ),
    ),
    created: concepts
      .filter((item) => item.action === "create")
      .map((item) => idOf(item.path))
      .sort(),
    updated: concepts
      .filter((item) => item.action === "update" && !deprecated.includes(idOf(item.path)))
      .map((item) => idOf(item.path))
      .sort(),
    deprecated,
  };
}

/**
 * A scanned document's text exactly as its bytes hold it. The scanner's decoder drops a leading
 * byte order mark, so it is restored when the bytes' hash says it was there; null when neither
 * text matches the bytes.
 */
export function scannedText(source: RepositorySource): string | null {
  if (source.content === undefined || source.contentHash === null) return null;
  if (sha256(source.content) === source.contentHash) return source.content;
  const marked = `\uFEFF${source.content}`;
  return sha256(marked) === source.contentHash ? marked : null;
}

/** The requested documents the scan read whole and that exceed the single-pass bound. */
export function requestedDocuments(
  scan: RepositoryKnowledgeScan,
  sourcePaths: readonly string[],
  boundBytes: number,
): SplitSource[] {
  return [...new Set(sourcePaths)].sort().flatMap((path): SplitSource[] => {
    const source = scan.sources.find((item) => item.path === path);
    const content = source === undefined ? null : scannedText(source);
    return source?.status === "included" &&
      source.kind === "documentation" &&
      content !== null &&
      source.contentHash !== null &&
      path.endsWith(".md") &&
      source.byteCount > boundBytes
      ? [
          {
            ...source,
            content,
            contentHash: source.contentHash,
            unread: false,
            data: source.byteCount > DOCUMENT_SIZE_SPLIT_MAXIMUM_BYTES,
          },
        ]
      : [];
  });
}
