import { posix } from "node:path";

import { fromMarkdown } from "mdast-util-from-markdown";
import type { DecisionTaxonomy } from "@lervo/project";

import { bytePreservedDocumentCollection } from "./document-layout.js";
import { sha256 } from "./integrity.js";
import type { RepositoryLayoutCandidate } from "./repository-layout-candidates.js";
import type { RepositoryLayoutReferenceUpdate } from "./repository-layout-plan.js";
import { observedOnlySource } from "./scan-retention.js";
import { readObservedSourceText } from "./scanner-file-source.js";
import {
  RepositoryKnowledgeError,
  type RepositoryKnowledgeScan,
  type RepositorySource,
} from "./types.js";

/** A non-moving file whose references to moved documents change. */
export interface RepositoryLayoutReferenceChange {
  source: RepositorySource & { content: string; contentHash: string };
  content: string;
  count: number;
}

export interface RepositoryLayoutReferenceRewrites {
  /** Rewritten files that stay in place, keyed by path in scan order. */
  referenceChanges: Map<string, RepositoryLayoutReferenceChange>;
  /** Rewritten bytes of moving documents, keyed by their current path. */
  movedContentChanges: Map<string, { content: string; count: number }>;
}

function replaceAllLiteral(
  content: string,
  from: string,
  to: string,
): { content: string; count: number } {
  if (from.length === 0 || from === to) return { content, count: 0 };
  const parts = content.split(from);
  return parts.length === 1
    ? { content, count: 0 }
    : { content: parts.join(to), count: parts.length - 1 };
}

function rewriteReferences(
  sourcePath: string,
  content: string,
  moves: Array<{ fromPath: string; toPath: string }>,
): { content: string; count: number } {
  let output = content;
  let count = 0;
  const sourceDirectory = posix.dirname(sourcePath);
  for (const move of moves) {
    const fromRelative = posix.relative(sourceDirectory, move.fromPath);
    const toRelative = posix.relative(sourceDirectory, move.toPath);
    const variants: string[][] = [
      ...(fromRelative.startsWith(".")
        ? [[fromRelative, toRelative]]
        : [
            [`./${fromRelative}`, `./${toRelative}`],
            [fromRelative, toRelative],
          ]),
    ];
    if (move.fromPath !== fromRelative) variants.push([move.fromPath, move.toPath]);
    for (const [from, to] of variants) {
      const replaced = replaceAllLiteral(output, from!, to!);
      output = replaced.content;
      count += replaced.count;
    }
  }
  return { content: output, count };
}

interface PositionedMarkdownNode {
  type?: string;
  url?: string;
  position?: { start?: { offset?: number }; end?: { offset?: number } };
  children?: PositionedMarkdownNode[];
}

function rebaseMarkdownLinks(
  content: string,
  fromPath: string,
  toPath: string,
): { content: string; count: number } {
  const tree = fromMarkdown(content) as PositionedMarkdownNode;
  const replacements: Array<{ start: number; end: number; value: string }> = [];
  const visit = (node: PositionedMarkdownNode): void => {
    if (
      (node.type === "link" || node.type === "image" || node.type === "definition") &&
      typeof node.url === "string" &&
      node.url.length > 0 &&
      !/^(?:[a-z][a-z0-9+.-]*:|\/|#)/iu.test(node.url)
    ) {
      const match = /^([^?#]*)([?#].*)?$/u.exec(node.url);
      const relativeTarget = match?.[1] ?? "";
      if (relativeTarget.length > 0) {
        const absoluteTarget = posix.normalize(posix.join(posix.dirname(fromPath), relativeTarget));
        let rebased = posix.relative(posix.dirname(toPath), absoluteTarget);
        if (!rebased.startsWith(".")) rebased = `./${rebased}`;
        rebased += match?.[2] ?? "";
        if (rebased !== node.url) {
          const start = node.position?.start?.offset;
          const end = node.position?.end?.offset;
          if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end))
            throw new RepositoryKnowledgeError(
              "knowledge_unit_extraction_failed",
              "The Markdown reference coordinates cannot be determined.",
            );
          const slice = content.slice(start, end);
          const destinationMarker = node.type === "definition" ? "]:" : "](";
          const marker = slice.indexOf(destinationMarker);
          const local =
            marker < 0 ? -1 : slice.indexOf(node.url, marker + destinationMarker.length);
          if (local < 0)
            throw new RepositoryKnowledgeError(
              "knowledge_unit_extraction_failed",
              "The Markdown reference destination cannot be determined.",
            );
          replacements.push({
            start: start! + local,
            end: start! + local + node.url.length,
            value: rebased,
          });
        }
      }
    }
    for (const child of node.children ?? []) visit(child);
  };
  visit(tree);
  let output = content;
  for (const replacement of replacements.sort((left, right) => right.start - left.start))
    output = `${output.slice(0, replacement.start)}${replacement.value}${output.slice(replacement.end)}`;
  return { content: output, count: replacements.length };
}

/**
 * Rewrites every included, user-owned text file that names a moved document, and rebases the
 * relative links inside each moving document to its destination.
 */
export async function planRepositoryLayoutReferenceRewrites(input: {
  root: string;
  scan: RepositoryKnowledgeScan;
  taxonomy: DecisionTaxonomy;
  generatedPaths: ReadonlySet<string>;
  movePaths: Array<{ fromPath: string; toPath: string }>;
}): Promise<RepositoryLayoutReferenceRewrites> {
  const { root, scan, taxonomy, generatedPaths, movePaths } = input;
  const referenceChanges = new Map<string, RepositoryLayoutReferenceChange>();
  const movedContentChanges = new Map<string, { content: string; count: number }>();
  for (const scanned of scan.sources) {
    if (
      scanned.status !== "included" ||
      scanned.contentHash === null ||
      generatedPaths.has(scanned.path) ||
      bytePreservedDocumentCollection(scanned.path, taxonomy) ||
      scanned.path.startsWith(".lervo/") ||
      scanned.path.startsWith("knowledge/")
    )
      continue;
    // An observed-only file (ADR-0544) may still name a moved document, so it is reread once here;
    // only the rewritten text of a changed file stays in memory.
    const content =
      scanned.content ??
      (observedOnlySource(scanned) && movePaths.length > 0 && !scanned.path.startsWith("@")
        ? await readObservedSourceText(root, scanned)
        : undefined);
    if (content === undefined) continue;
    const source = { ...scanned, content };
    const move = movePaths.find((item) => item.fromPath === source.path);
    const rebased =
      move === undefined
        ? { content: source.content, count: 0 }
        : rebaseMarkdownLinks(source.content, source.path, move.toPath);
    const rewritten = rewriteReferences(move?.toPath ?? source.path, rebased.content, movePaths);
    rewritten.count += rebased.count;
    if (rewritten.count === 0) continue;
    if (move !== undefined) movedContentChanges.set(source.path, rewritten);
    else
      referenceChanges.set(source.path, {
        source: { ...source, contentHash: scanned.contentHash },
        content: rewritten.content,
        count: rewritten.count,
      });
  }
  return { referenceChanges, movedContentChanges };
}

/** The exact before and after bytes of every rewritten file, at its post-migration path. */
export function repositoryLayoutReferenceUpdates(input: {
  referenceChanges: ReadonlyMap<string, RepositoryLayoutReferenceChange>;
  movedContentChanges: ReadonlyMap<string, { content: string; count: number }>;
  executableCandidates: RepositoryLayoutCandidate[];
}): RepositoryLayoutReferenceUpdate[] {
  return [
    ...[...input.referenceChanges.values()].map((change) => ({
      path: change.source.path,
      beforeHash: change.source.contentHash,
      afterHash: sha256(change.content),
      replacementCount: change.count,
    })),
    ...input.executableCandidates.flatMap((item) => {
      const change = input.movedContentChanges.get(item.source.path);
      return change === undefined
        ? []
        : [
            {
              path: item.toPath,
              beforeHash: item.source.contentHash!,
              afterHash: sha256(change.content),
              replacementCount: change.count,
            },
          ];
    }),
  ].sort((left, right) => left.path.localeCompare(right.path));
}
