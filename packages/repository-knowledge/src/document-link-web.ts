import { posix } from "node:path";

import { extractDocumentReferences } from "./document-references.js";
import { historicalDocumentMarker } from "./historical-documents.js";

export interface DocumentLinkWebInput {
  documents: readonly { path: string; content: string }[];
  /** Tracked file and directory paths, for resolving link targets. */
  trackedPaths: ReadonlySet<string>;
  /** Paths whose documents need inbound links, such as decisions and specifications. */
  canonical: (path: string) => boolean;
  archiveScopes: readonly string[];
}

export interface DocumentLinkWeb {
  documentCount: number;
  linkCount: number;
  broken: { path: string; line: number; target: string }[];
  /** Current canonical documents that no other document links to. */
  orphans: string[];
  /** An `Amends:` header link whose target does not link back. */
  missingBacklinks: { path: string; target: string }[];
}

const AMENDS = /^Amends:\s*(.+)$/mu;
const LINK_TARGET = /\]\(([^)\s#]+)(?:#[^)]*)?\)/gu;

function amendedTargets(path: string, content: string): string[] {
  const header = AMENDS.exec(content.slice(0, 4096))?.[1];
  if (header === undefined) return [];
  return [...header.matchAll(LINK_TARGET)]
    .map((match) => match[1]!)
    .filter((target) => !/^[a-z]+:/iu.test(target) && !target.startsWith("/"))
    .map((target) => posix.normalize(posix.join(posix.dirname(path), target)))
    .filter((target) => !target.startsWith(".."));
}

/**
 * ADR-0551: the deterministic link web over current Markdown. It reads no provider and writes
 * nothing; historical documents are frozen records, so they neither need nor give inbound links
 * and their broken links are not reported.
 */
export function buildDocumentLinkWeb(input: DocumentLinkWebInput): DocumentLinkWeb {
  const current = input.documents.filter(
    (document) =>
      historicalDocumentMarker({
        path: document.path,
        content: document.content,
        archiveScopes: input.archiveScopes,
      }) === null,
  );
  const inbound = new Map<string, number>();
  const linksFrom = new Map<string, Set<string>>();
  const broken: DocumentLinkWeb["broken"] = [];
  let linkCount = 0;
  for (const document of current) {
    const targets = new Set<string>();
    for (const reference of extractDocumentReferences(document)) {
      if (reference.kind !== "markdown_link") continue;
      linkCount += 1;
      targets.add(reference.target);
      if (!input.trackedPaths.has(reference.target))
        broken.push({ path: document.path, line: reference.line, target: reference.target });
      else if (reference.target !== document.path)
        inbound.set(reference.target, (inbound.get(reference.target) ?? 0) + 1);
    }
    linksFrom.set(document.path, targets);
  }
  const orphans = current
    .map((document) => document.path)
    .filter((path) => input.canonical(path) && (inbound.get(path) ?? 0) === 0);
  const missingBacklinks: DocumentLinkWeb["missingBacklinks"] = [];
  for (const document of current)
    for (const target of amendedTargets(document.path, document.content)) {
      const back = linksFrom.get(target);
      // A missing or historical target is a broken link or a frozen record, not a back-link gap.
      if (back !== undefined && !back.has(document.path))
        missingBacklinks.push({ path: document.path, target });
    }
  const byPath = (left: { path: string }, right: { path: string }) =>
    left.path < right.path ? -1 : left.path > right.path ? 1 : 0;
  return {
    documentCount: current.length,
    linkCount,
    broken: broken.sort(byPath),
    orphans: orphans.sort(),
    missingBacklinks: missingBacklinks.sort(byPath),
  };
}
