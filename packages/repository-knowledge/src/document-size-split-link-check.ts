// ADR-0653: the semantic check of a split's rewritten links, beside the byte check. The byte check
// proves a file is its original range plus recorded rewrites; this one proves each rewrite still
// names what the original named, once the whole plan is written.
import { posix } from "node:path";

import {
  destinationParts,
  destinationPath,
  type SplitAnchorFiles,
  type SplitLinkRewrite,
} from "./document-size-split-links.js";

/** The file and fragment a raw destination names, read from a file at `fromPath`. */
function resolved(raw: string, fromPath: string): { file: string; fragment: string } {
  const { path, fragment } = destinationParts(raw);
  return {
    file:
      path.length === 0
        ? fromPath
        : posix.normalize(posix.join(posix.dirname(fromPath), destinationPath(path))),
    fragment: destinationPath(fragment).toLowerCase(),
  };
}

const anchorIndex = new WeakMap<SplitAnchorFiles, Map<string, Set<string>>>();

/** Every anchor each written file of a split holds, lowercased. */
function anchorsByFile(anchorFiles: SplitAnchorFiles): Map<string, Set<string>> {
  const known = anchorIndex.get(anchorFiles);
  if (known !== undefined) return known;
  const files = new Map<string, Set<string>>();
  for (const anchors of anchorFiles.values())
    for (const target of anchors.values()) {
      const held = files.get(target.file) ?? new Set<string>();
      held.add(target.anchor.toLowerCase());
      files.set(target.file, held);
    }
  anchorIndex.set(anchorFiles, files);
  return files;
}

/**
 * The rewritten destinations of `pieces`, text that came from `documentPath`, that do not name
 * what the original named once the plan is written. A destination that named a heading of a split
 * document must name a file the plan writes and an anchor that file holds; any other must name
 * the same file and fragment as before, so a rebased link reaches the unchanged file it reached.
 */
export function brokenRewrites(input: {
  documentPath: string;
  pieces: ReadonlyArray<{ path: string; rewrites: readonly SplitLinkRewrite[] }>;
  writes: ReadonlySet<string>;
  anchorFiles: SplitAnchorFiles;
}): string[] {
  const held = anchorsByFile(input.anchorFiles);
  const broken: string[] = [];
  for (const piece of input.pieces)
    for (const rewrite of piece.rewrites) {
      const before = resolved(rewrite.before, input.documentPath);
      const after = resolved(rewrite.after, piece.path);
      const followed = input.anchorFiles.has(before.file) && before.fragment.length > 0;
      const kept = followed
        ? input.writes.has(after.file) && held.get(after.file)?.has(after.fragment) === true
        : after.file === before.file && after.fragment === before.fragment;
      if (!kept) broken.push(`${piece.path}: ${rewrite.after}`);
    }
  return broken;
}
