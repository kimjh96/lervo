import { extractDocumentReferences } from "./document-references.js";
import { historicalDocumentMarker } from "./historical-documents.js";

/** Repository paths (files or directories) named by current canonical documents. */
export interface GoverningIndex {
  documents: string[];
  /** Referenced path → indexes into `documents`, each list sorted. */
  entries: Record<string, number[]>;
}

const MAXIMUM_DOCUMENTS_PER_PATH = 16;

/**
 * ADR-0552: a canonical document governs the code and configuration paths it names. Only strong
 * references count: Markdown links, fenced file names, and inline code paths with an extension or
 * a trailing slash. Historical documents govern nothing.
 */
export function buildGoverningIndex(input: {
  documents: readonly { path: string; content: string }[];
  canonical: (path: string) => boolean;
  archiveScopes: readonly string[];
}): GoverningIndex {
  const documents = input.documents
    .filter(
      (document) =>
        input.canonical(document.path) &&
        historicalDocumentMarker({
          path: document.path,
          content: document.content,
          archiveScopes: input.archiveScopes,
        }) === null,
    )
    .sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
  const entries: Record<string, number[]> = {};
  documents.forEach((document, index) => {
    for (const reference of extractDocumentReferences(document)) {
      if (reference.weak || /\.mdx?$/iu.test(reference.target)) continue;
      const list = (entries[reference.target] ??= []);
      if (list.at(-1) !== index && list.length < MAXIMUM_DOCUMENTS_PER_PATH) list.push(index);
    }
  });
  return { documents: documents.map((document) => document.path), entries };
}

/** Documents governing a changed path: the path itself and every directory above it. */
export function governingDocumentsFor(index: GoverningIndex, path: string): string[] {
  const found = new Set<number>();
  const segments = path.split("/");
  for (let length = segments.length; length >= 1; length -= 1) {
    const prefix = segments.slice(0, length).join("/");
    for (const key of length === segments.length ? [prefix] : [prefix, `${prefix}/`])
      for (const entry of index.entries[key] ?? []) found.add(entry);
  }
  return [...found].sort((left, right) => left - right).map((entry) => index.documents[entry]!);
}
