// ADR-0653: splitting several documents whose links name each other's headings. A document's
// layout decides where its headings go, and a link to one of them changes the size of the linking
// document's files and so its layout, so the documents render again until no layout changes.
import { posix } from "node:path";

import {
  documentFacts,
  splitOversizedDocument,
  type DocumentFacts,
  type SplitDocument,
  type UnsplittableReason,
} from "./document-size-split-layout.js";
import type { SplitAnchorFiles } from "./document-size-split-links.js";
import { mentionsFileName } from "./document-size-split-names.js";

/** Rounds a set of documents renders again before a document whose links still move fails. */
const SETTLE_ROUNDS = 4;

export interface SettledSplit<Source> {
  source: Source;
  split: SplitDocument | UnsplittableReason;
  /** False when the anchors it links to still moved after the last round; it must not be written. */
  settled: boolean;
}

/**
 * Each document's split, its links following headings across every document split with it. A
 * document renders again only when the anchors of a document it names changed since it last
 * rendered, so unchanged documents are never rendered twice. A document still unsettled after the
 * last round is returned with `settled: false`, never passed as current. Each document's facts are
 * read once, from `facts` when the caller read them already.
 */
export function splitDocuments<Source extends { path: string; content: string }>(
  sources: readonly Source[],
  boundBytes: number,
  facts: Map<string, DocumentFacts> = new Map(),
): Array<SettledSplit<Source>> {
  const factsOf = (source: Source) => {
    const known = facts.get(source.path);
    if (known !== undefined) return known;
    const read = documentFacts(source.content);
    facts.set(source.path, read);
    return read;
  };
  const splits = sources.map((source) => ({
    source,
    split: splitOversizedDocument(
      source.path,
      source.content,
      boundBytes,
      new Map(),
      factsOf(source),
    ),
    seen: "[]",
  }));
  const anchors = () =>
    new Map(
      splits.flatMap(({ source, split }) =>
        typeof split === "string" ? [] : [[source.path, split.anchors] as const],
      ),
    );
  // The anchors a document can name: those of every other split document whose file name it holds.
  const named = (source: Source, all: SplitAnchorFiles) =>
    new Map(
      [...all].filter(
        ([path]) => path !== source.path && mentionsFileName(source.content, posix.basename(path)),
      ),
    );
  const fingerprint = (files: SplitAnchorFiles) =>
    JSON.stringify([...files].map(([path, map]) => [path, [...map]]));
  for (let round = 0; round < SETTLE_ROUNDS; round += 1) {
    const current = anchors();
    let changed = false;
    for (const entry of splits) {
      if (typeof entry.split === "string") continue;
      const foreign = named(entry.source, current);
      const seen = fingerprint(foreign);
      if (seen === entry.seen) continue;
      changed = true;
      entry.seen = seen;
      entry.split = splitOversizedDocument(
        entry.source.path,
        entry.source.content,
        boundBytes,
        foreign,
        factsOf(entry.source),
      );
    }
    if (!changed) break;
  }
  const final = anchors();
  return splits.map(({ source, split, seen }) => ({
    source,
    split,
    settled: typeof split === "string" || fingerprint(named(source, final)) === seen,
  }));
}
