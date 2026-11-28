// ADR-0653: the other documents of a repository that link to a heading of a split document. Their
// links follow the heading into the part that now holds it, recorded so the check can undo them.
import { posix } from "node:path";

import {
  rewriteSplitLinks,
  type SplitAnchorFiles,
  type SplitLinkRewrite,
} from "./document-size-split-links.js";
import { sha256 } from "./integrity.js";
import type { RepositoryKnowledgeScan } from "./types.js";

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
 * document's file name are parsed.
 */
export function splitReferenceUpdates(
  scan: RepositoryKnowledgeScan,
  anchorFiles: SplitAnchorFiles,
): SplitReferenceUpdate[] {
  if (anchorFiles.size === 0) return [];
  const names = [...anchorFiles.keys()].map((path) => posix.basename(path));
  return scan.sources.flatMap((source): SplitReferenceUpdate[] => {
    if (
      source.status !== "included" ||
      source.content === undefined ||
      source.contentHash === null ||
      !source.path.endsWith(".md") ||
      anchorFiles.has(source.path) ||
      !names.some((name) => source.content!.includes(`${name}#`))
    )
      return [];
    const links = rewriteSplitLinks({
      text: source.content,
      fromPath: source.path,
      toPath: source.path,
      anchorFiles,
    });
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
