import type { AdapterContextEnvelope } from "@lervo/schemas";
import { fromMarkdown } from "mdast-util-from-markdown";

import { managedContextReferenceToken } from "./context-reference.js";

interface PositionedNode {
  type?: unknown;
  value?: unknown;
  position?: {
    start?: { offset?: number };
    end?: { offset?: number };
  };
  children?: readonly PositionedNode[];
}

interface CharacterRange {
  start: number;
  end: number;
}

export class ManagedContextReferenceError extends Error {
  readonly code: "commonmark_parse_failed" | "json_parse_failed" | "reference_not_standalone";

  constructor(code: ManagedContextReferenceError["code"], message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ManagedContextReferenceError";
    this.code = code;
  }
}

export interface ManagedContextReferenceProjection {
  referencedDocuments: AdapterContextEnvelope["documents"];
  publicationContent: string;
}

function positionedRanges(root: PositionedNode): {
  code: readonly CharacterRange[];
  html: readonly (CharacterRange & { value: string })[];
} {
  const code: CharacterRange[] = [];
  const html: Array<CharacterRange & { value: string }> = [];
  const visit = (node: PositionedNode): void => {
    const start = node.position?.start?.offset;
    const end = node.position?.end?.offset;
    if (typeof start === "number" && typeof end === "number") {
      if (node.type === "code" || node.type === "inlineCode") code.push({ start, end });
      if (node.type === "html" && typeof node.value === "string") {
        html.push({ start, end, value: node.value });
      }
    }
    for (const child of node.children ?? []) visit(child);
  };
  visit(root);
  return { code, html };
}

function contains(outer: CharacterRange, inner: CharacterRange): boolean {
  return outer.start <= inner.start && inner.end <= outer.end;
}

function standaloneLineRange(content: string, range: CharacterRange): CharacterRange | null {
  const lineStart = content.lastIndexOf("\n", range.start - 1) + 1;
  const newline = content.indexOf("\n", range.end);
  const lineEnd = newline === -1 ? content.length : newline + 1;
  const contentEnd = newline === -1 ? content.length : newline;
  const before = content.slice(lineStart, range.start);
  const after = content.slice(range.end, contentEnd).replace(/\r$/u, "");
  return /^[\t ]*$/u.test(before) && /^[\t ]*$/u.test(after)
    ? { start: lineStart, end: lineEnd }
    : null;
}

function exactReferenceToken(value: string, tokens: readonly string[]): string | null {
  const comment = value.replace(/^[\t ]+|[\t ]+$/gu, "");
  for (const token of tokens) {
    if (comment === `<!-- ${token} -->`) return token;
    const escaped = token.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
    if (new RegExp(`^<!--[\\t ]*${escaped}[\\t ]*-->$`, "u").test(comment)) return token;
  }
  return null;
}

function eligibleDocuments(
  documents: AdapterContextEnvelope["documents"],
): AdapterContextEnvelope["documents"] {
  return documents.filter(
    (document) => document.documentRole === "task_evidence" && document.referenceEligible,
  );
}

export function projectManagedContextReferences(
  content: string,
  documents: AdapterContextEnvelope["documents"],
): ManagedContextReferenceProjection {
  let ranges: ReturnType<typeof positionedRanges>;
  try {
    ranges = positionedRanges(fromMarkdown(content) as PositionedNode);
  } catch (error) {
    throw new ManagedContextReferenceError(
      "commonmark_parse_failed",
      `Managed context references could not be parsed as CommonMark: ${error instanceof Error ? error.message : "unknown parser failure"}`,
      { cause: error },
    );
  }

  const eligible = eligibleDocuments(documents);
  const byToken = new Map(
    eligible.map((document) => [managedContextReferenceToken(document), document] as const),
  );
  const tokens = [...byToken.keys()];
  const referencedTokens = new Set<string>();
  const removals: CharacterRange[] = [];
  for (const html of ranges.html) {
    if (/^<!--[\t ]*-->$/u.test(html.value.trim())) {
      removals.push(standaloneLineRange(content, html) ?? html);
      continue;
    }
    const token = exactReferenceToken(html.value, tokens);
    if (token === null) continue;
    const line = standaloneLineRange(content, html);
    if (line === null) continue;
    referencedTokens.add(token);
    removals.push(line);
  }

  for (const token of tokens) {
    let start = 0;
    while ((start = content.indexOf(token, start)) !== -1) {
      const occurrence = { start, end: start + token.length };
      const accepted = removals.some((range) => contains(range, occurrence));
      const quotedAsCode = ranges.code.some((range) => contains(range, occurrence));
      if (!accepted && !quotedAsCode) {
        throw new ManagedContextReferenceError(
          "reference_not_standalone",
          "A managed context reference must be an exact standalone HTML comment outside code.",
        );
      }
      start = occurrence.end;
    }
  }

  let publicationContent = content;
  for (const range of removals.sort((left, right) => right.start - left.start)) {
    publicationContent =
      publicationContent.slice(0, range.start) + publicationContent.slice(range.end);
  }
  return {
    referencedDocuments: eligible
      .filter((document) => referencedTokens.has(managedContextReferenceToken(document)))
      .map((document) => structuredClone(document)),
    publicationContent,
  };
}
