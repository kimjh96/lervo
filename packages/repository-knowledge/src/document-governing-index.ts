import { relationNodeParts } from "./relation-web-model.js";
import type { RelationWeb } from "./relation-web.js";

/** Repository paths (files or directories) named by current canonical documents. */
export interface GoverningIndex {
  documents: string[];
  /** Referenced path → indexes into `documents`, each list sorted. */
  entries: Record<string, number[]>;
  /** Documents that reached the reference bound; they may govern more than recorded. */
  truncated: string[];
}

const MAXIMUM_DOCUMENTS_PER_PATH = 16;
const GOVERNING_ROLES = new Set(["instructions", "canonical_documents"]);

/**
 * ADR-0552 as a view of the relation web (ADR-0562, roadmap item 8): a current canonical document
 * governs the code and configuration paths it names. Only strong references count: Markdown links,
 * fenced file names, and inline code paths with an extension or a trailing slash. Historical
 * documents and roadmaps, which name paths as delivery evidence, govern nothing.
 */
export function governingIndexFromRelationWeb(web: RelationWeb): GoverningIndex {
  const documents = [...web.documents.values()]
    .filter(
      (document) =>
        GOVERNING_ROLES.has(document.role) &&
        !document.historical &&
        !document.path.split("/").includes("roadmap"),
    )
    .sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
  const entries: Record<string, number[]> = {};
  const truncated: string[] = [];
  documents.forEach((document, index) => {
    if (document.truncated) truncated.push(document.path);
    for (const edge of document.edges) {
      if (
        edge.kind !== "links_to" &&
        !(edge.kind === "names_path" && edge.evidence.strength === "strong")
      )
        continue;
      const { kind, key } = relationNodeParts(edge.to);
      if (kind !== "path" || /\.mdx?$/iu.test(key)) continue;
      const list = (entries[key] ??= []);
      if (list.at(-1) !== index && list.length < MAXIMUM_DOCUMENTS_PER_PATH) list.push(index);
    }
  });
  return { documents: documents.map((document) => document.path), entries, truncated };
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
