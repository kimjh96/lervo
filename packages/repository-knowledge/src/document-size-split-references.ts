// ADR-0653: the other documents of a repository that link to a heading of a split document. Their
// links follow the heading into the part that now holds it, recorded so the check can undo them.
import { posix } from "node:path";

import { brokenRewrites } from "./document-size-split-link-check.js";
import {
  rewriteSplitLinks,
  type SplitAnchorFiles,
  type SplitLinkRewrite,
} from "./document-size-split-links.js";
import { scannedText } from "./document-size-split-sources.js";
import { sha256 } from "./integrity.js";
import type { RepositoryKnowledgeScan } from "./types.js";
import { mentionsFileName } from "./document-size-split-names.js";

export interface SplitReferenceUpdate {
  path: string;
  beforeHash: string;
  afterHash: string;
  linkRewrites: SplitLinkRewrite[];
  unkeptLinks: string[];
  content: string;
}

/**
 * Every included Markdown document outside the split whose links name a split document's heading,
 * with those links rewritten to the part that now holds it. Only documents that mention a split
 * document's file name are parsed. A document whose rewritten links would not reach the heading in
 * a file the plan writes is left unchanged, and each of those links is named as not kept.
 */
export function splitReferenceUpdates(
  scan: RepositoryKnowledgeScan,
  anchorFiles: SplitAnchorFiles,
  writes: ReadonlySet<string>,
): SplitReferenceUpdate[] {
  if (anchorFiles.size === 0) return [];
  const names = [...anchorFiles.keys()].map((path) => posix.basename(path));
  return scan.sources.flatMap((source): SplitReferenceUpdate[] => {
    const text = source.status === "included" ? scannedText(source) : null;
    if (
      text === null ||
      source.contentHash === null ||
      !source.path.endsWith(".md") ||
      anchorFiles.has(source.path) ||
      !names.some((name) => mentionsFileName(text, name))
    )
      return [];
    const links = rewriteSplitLinks({
      text,
      fromPath: source.path,
      toPath: source.path,
      anchorFiles,
    });
    const broken = brokenRewrites({
      documentPath: source.path,
      pieces: [{ path: source.path, rewrites: links.rewrites }],
      writes,
      anchorFiles,
    });
    if (broken.length > 0)
      return [
        {
          path: source.path,
          beforeHash: source.contentHash,
          afterHash: source.contentHash,
          linkRewrites: [],
          unkeptLinks: [...links.unkept, ...links.rewrites.map((rewrite) => rewrite.before)],
          content: text,
        },
      ];
    return links.rewrites.length === 0 && links.unkept.length === 0
      ? []
      : [
          {
            path: source.path,
            beforeHash: source.contentHash,
            afterHash: sha256(links.content),
            linkRewrites: links.rewrites,
            unkeptLinks: links.unkept,
            content: links.content,
          },
        ];
  });
}
