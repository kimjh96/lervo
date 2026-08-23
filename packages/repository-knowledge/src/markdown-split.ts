import { fromMarkdown } from "mdast-util-from-markdown";

import { RepositoryKnowledgeError } from "./types.js";

interface PositionedNode {
  type: string;
  depth?: number;
  value?: string;
  children?: PositionedNode[];
  position?: { start?: { offset?: number }; end?: { offset?: number } };
}

export interface MarkdownHeadingSplit {
  locator: string;
  title: string;
  depth: number;
  extractedRange: { startByte: number; endByte: number };
  sourceContent: string;
  destinationContent: string;
}

function nodeText(node: PositionedNode): string {
  if (typeof node.value === "string") return node.value;
  return (node.children ?? []).map(nodeText).join("");
}

export function splitMarkdownHeadingSubtree(content: string, requestedLocator: string): MarkdownHeadingSplit {
  if (!requestedLocator.startsWith("heading:") || requestedLocator.length > 500) {
    throw new RepositoryKnowledgeError("knowledge_reconciliation_conflict", "The split heading locator must use the heading:<path> format.");
  }
  let root: PositionedNode;
  try { root = fromMarkdown(content) as PositionedNode; }
  catch { throw new RepositoryKnowledgeError("knowledge_unit_extraction_failed", "Markdown cannot be parsed safely as CommonMark structure."); }
  const headings = (root.children ?? []).filter((node) => node.type === "heading");
  if (headings.length < 2 || headings.length > 4096) {
    throw new RepositoryKnowledgeError("knowledge_reconciliation_conflict", "The split source requires at least two bounded CommonMark headings.");
  }
  const stack: Array<{ depth: number; title: string }> = [];
  const descriptors = headings.map((node, index) => {
    const depth = node.depth ?? 0;
    const title = nodeText(node).trim();
    const startCharacter = node.position?.start?.offset;
    if (depth < 1 || depth > 6 || title.length === 0 || title.length > 300 || !Number.isSafeInteger(startCharacter)) {
      throw new RepositoryKnowledgeError("knowledge_unit_extraction_failed", "The split heading has invalid CommonMark coordinates.");
    }
    while (stack.length > 0 && stack[stack.length - 1]!.depth >= depth) stack.pop();
    const locator = `heading:${[...stack.map((item) => item.title), title].join(" > ")}`;
    stack.push({ depth, title });
    return { node, index, depth, title, locator, startCharacter: startCharacter as number };
  });
  const matches = descriptors.filter((item) => item.locator === requestedLocator);
  if (matches.length !== 1) {
    throw new RepositoryKnowledgeError("knowledge_reconciliation_conflict", matches.length === 0 ? "The split heading locator was not found." : "The split heading locator is ambiguous because it is duplicated.");
  }
  const selected = matches[0]!;
  const next = descriptors.slice(selected.index + 1).find((item) => item.depth <= selected.depth);
  const endCharacter = next?.startCharacter ?? content.length;
  const startByte = Buffer.byteLength(content.slice(0, selected.startCharacter));
  const endByte = Buffer.byteLength(content.slice(0, endCharacter));
  const bytes = Buffer.from(content);
  const destinationBytes = bytes.subarray(startByte, endByte);
  const sourceBytes = Buffer.concat([bytes.subarray(0, startByte), bytes.subarray(endByte)]);
  if (startByte <= 0 || endByte <= startByte || sourceBytes.byteLength === 0 || destinationBytes.byteLength === 0) {
    throw new RepositoryKnowledgeError("knowledge_reconciliation_conflict", "The selected heading subtree must leave both source and destination non-empty.");
  }
  return {
    locator: selected.locator,
    title: selected.title,
    depth: selected.depth,
    extractedRange: { startByte, endByte },
    sourceContent: sourceBytes.toString("utf8"),
    destinationContent: destinationBytes.toString("utf8"),
  };
}
