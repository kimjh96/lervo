import { fromMarkdown } from "mdast-util-from-markdown";

import type {
  DocumentByteRange,
  IgnoredManagedMarker,
  ManagedBlockDiagnostic,
  ManagedBlockMarkerFamily,
  ManagedBlockParseResult,
  ParsedManagedBlock,
} from "./managed-block-types.js";

const MAXIMUM_DOCUMENT_BYTES = 4 * 1024 * 1024;
const MAXIMUM_MANAGED_BLOCK_BYTES = 8 * 1024;
const MAXIMUM_MARKER_CANDIDATES = 256;
const PREVIOUS_PRODUCT_PREFIX = "ro" + "ven";

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

interface CodeCharacterRange extends CharacterRange {
  reason: IgnoredManagedMarker["reason"];
}

interface SourceLine {
  contentStart: number;
  contentEnd: number;
  lineEnd: number;
  contentStartByte: number;
  lineTerminatorBytes: number;
  content: string;
}

interface MarkerCandidate {
  characterRange: CharacterRange;
  byteRange: DocumentByteRange;
  line: SourceLine;
  text: string;
}

interface ParsedMarker extends MarkerCandidate {
  kind: "begin" | "end";
  blockId: string;
  family: ManagedBlockMarkerFamily;
}

interface OpenMarker {
  marker: ParsedMarker;
  contentStart: number;
}

function emptyResult(byteCount: number, diagnostic: ManagedBlockDiagnostic): ManagedBlockParseResult {
  return {
    parserId: "lervo/commonmark-managed-blocks",
    parserVersion: "1.0.0",
    status: "invalid",
    byteCount,
    blocks: [],
    unmanagedRanges: [],
    ignoredMarkers: [],
    diagnostics: [diagnostic],
  };
}

function positionedRanges(root: PositionedNode): {
  code: readonly CodeCharacterRange[];
  html: readonly CharacterRange[];
} {
  const code: CodeCharacterRange[] = [];
  const html: CharacterRange[] = [];
  const visit = (node: PositionedNode): void => {
    const start = node.position?.start?.offset;
    const end = node.position?.end?.offset;
    if (typeof start === "number" && typeof end === "number") {
      if (node.type === "code" || node.type === "inlineCode") {
        code.push({ start, end, reason: node.type === "code" ? "code_block" : "inline_code" });
      }
      if (node.type === "html") html.push({ start, end });
    }
    for (const child of node.children ?? []) visit(child);
  };
  visit(root);
  return { code, html };
}

function sourceLines(source: string, initialByteOffset: number): readonly SourceLine[] {
  const lines: SourceLine[] = [];
  let start = 0;
  let startByte = initialByteOffset;
  while (start < source.length) {
    let contentEnd = start;
    while (contentEnd < source.length &&
           source[contentEnd] !== "\r" && source[contentEnd] !== "\n") contentEnd += 1;
    let lineEnd = contentEnd;
    if (source[lineEnd] === "\r") lineEnd += source[lineEnd + 1] === "\n" ? 2 : 1;
    else if (source[lineEnd] === "\n") lineEnd += 1;
    const content = source.slice(start, contentEnd);
    const lineTerminatorBytes = Buffer.byteLength(source.slice(contentEnd, lineEnd), "utf8");
    lines.push({
      contentStart: start,
      contentEnd,
      lineEnd,
      contentStartByte: startByte,
      lineTerminatorBytes,
      content,
    });
    startByte += Buffer.byteLength(content, "utf8") + lineTerminatorBytes;
    start = lineEnd;
  }
  if (source.length === 0) {
    lines.push({
      contentStart: 0,
      contentEnd: 0,
      lineEnd: 0,
      contentStartByte: initialByteOffset,
      lineTerminatorBytes: 0,
      content: "",
    });
  }
  return lines;
}

function candidatePrefixPattern(): RegExp {
  return new RegExp(`<!--\\s*(?:lervo|${PREVIOUS_PRODUCT_PREFIX}):`, "gi");
}

function markerCandidates(source: string, initialByteOffset: number): readonly MarkerCandidate[] {
  const result: MarkerCandidate[] = [];
  for (const line of sourceLines(source, initialByteOffset)) {
    const pattern = candidatePrefixPattern();
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(line.content)) !== null) {
      const relativeStart = match.index;
      const close = line.content.indexOf("-->", relativeStart);
      const relativeEnd = close === -1 ? line.content.length : close + 3;
      const start = line.contentStart + relativeStart;
      const end = line.contentStart + relativeEnd;
      result.push({
        characterRange: { start, end },
        byteRange: {
          start: line.contentStartByte + Buffer.byteLength(line.content.slice(0, relativeStart)),
          end: line.contentStartByte + Buffer.byteLength(line.content.slice(0, relativeEnd)),
        },
        line,
        text: source.slice(start, end),
      });
      if (result.length > MAXIMUM_MARKER_CANDIDATES) return result;
      pattern.lastIndex = Math.max(relativeEnd, pattern.lastIndex);
    }
  }
  return result;
}

function contains(outer: CharacterRange, inner: CharacterRange): boolean {
  return outer.start <= inner.start && inner.end <= outer.end;
}

function familyPrefix(family: ManagedBlockMarkerFamily): string {
  return family === "lervo_v1" ? "lervo" : PREVIOUS_PRODUCT_PREFIX;
}

function parseMarker(candidate: MarkerCandidate): ParsedMarker | null {
  for (const family of ["lervo_v1", "previous_product_v1"] as const) {
    const escaped = familyPrefix(family);
    const begin = new RegExp(`^<!-- ${escaped}:begin block=([a-z][a-z0-9_-]{0,99}) schema=1 -->$`).exec(candidate.text);
    if (begin?.[1] !== undefined) return { ...candidate, kind: "begin", blockId: begin[1], family };
    const end = new RegExp(`^<!-- ${escaped}:end block=([a-z][a-z0-9_-]{0,99}) -->$`).exec(candidate.text);
    if (end?.[1] !== undefined) return { ...candidate, kind: "end", blockId: end[1], family };
  }
  return null;
}

function unmanagedRanges(byteCount: number, blocks: readonly ParsedManagedBlock[]): readonly DocumentByteRange[] {
  const ranges: DocumentByteRange[] = [];
  let cursor = 0;
  for (const block of blocks) {
    if (cursor < block.fullRange.start) ranges.push({ start: cursor, end: block.fullRange.start });
    cursor = block.fullRange.end;
  }
  if (cursor < byteCount) ranges.push({ start: cursor, end: byteCount });
  return ranges;
}

export function parseManagedMarkdownBlocks(bytes: Uint8Array): ManagedBlockParseResult {
  if (bytes.byteLength > MAXIMUM_DOCUMENT_BYTES) {
    return emptyResult(bytes.byteLength, { code: "input_too_large" });
  }

  let source: string;
  const byteOrderMarkBytes = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? 3 : 0;
  try {
    source = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return emptyResult(bytes.byteLength, { code: "invalid_utf8" });
  }

  let ranges: ReturnType<typeof positionedRanges>;
  try {
    ranges = positionedRanges(fromMarkdown(source) as PositionedNode);
  } catch {
    return emptyResult(bytes.byteLength, { code: "commonmark_parse_failed" });
  }

  const candidates = markerCandidates(source, byteOrderMarkBytes);
  if (candidates.length > MAXIMUM_MARKER_CANDIDATES) {
    return emptyResult(bytes.byteLength, { code: "too_many_markers" });
  }

  const diagnostics: ManagedBlockDiagnostic[] = [];
  const ignoredMarkers: IgnoredManagedMarker[] = [];
  const markers: ParsedMarker[] = [];
  for (const candidate of candidates) {
    const containingCode = ranges.code.find((range) => contains(range, candidate.characterRange));
    if (containingCode !== undefined) {
      ignoredMarkers.push({
        range: candidate.byteRange,
        reason: containingCode.reason,
      });
      continue;
    }
    if (candidate.characterRange.start !== candidate.line.contentStart ||
        candidate.characterRange.end !== candidate.line.contentEnd) {
      diagnostics.push({ code: "marker_not_standalone", range: candidate.byteRange });
      continue;
    }
    if (!ranges.html.some((range) =>
      range.start === candidate.characterRange.start && range.end === candidate.characterRange.end
    )) {
      diagnostics.push({ code: "marker_not_commonmark_html", range: candidate.byteRange });
      continue;
    }
    const marker = parseMarker(candidate);
    if (marker === null) {
      diagnostics.push({ code: "invalid_marker_syntax", range: candidate.byteRange });
      continue;
    }
    markers.push(marker);
  }

  const blocks: ParsedManagedBlock[] = [];
  const completedIds = new Set<string>();
  let open: OpenMarker | undefined;
  for (const marker of markers) {
    if (marker.kind === "begin") {
      if (open !== undefined) {
        diagnostics.push({ code: "nested_begin_marker", range: marker.byteRange, blockId: marker.blockId });
        continue;
      }
      open = {
        marker,
        contentStart: marker.byteRange.end + marker.line.lineTerminatorBytes,
      };
      continue;
    }
    if (open === undefined) {
      diagnostics.push({ code: "unexpected_end_marker", range: marker.byteRange, blockId: marker.blockId });
      continue;
    }
    if (marker.blockId !== open.marker.blockId) {
      diagnostics.push({ code: "mismatched_end_marker", range: marker.byteRange, blockId: marker.blockId });
      continue;
    }
    if (marker.family !== open.marker.family) {
      diagnostics.push({ code: "mixed_marker_family", range: marker.byteRange, blockId: marker.blockId });
    }
    const contentEnd = marker.byteRange.start;
    const fullEnd = marker.byteRange.end + marker.line.lineTerminatorBytes;
    const block: ParsedManagedBlock = {
      blockId: marker.blockId,
      markerFamily: open.marker.family,
      startMarkerRange: open.marker.byteRange,
      contentRange: { start: open.contentStart, end: contentEnd },
      endMarkerRange: marker.byteRange,
      fullRange: { start: open.marker.byteRange.start, end: fullEnd },
    };
    if (block.contentRange.end - block.contentRange.start > MAXIMUM_MANAGED_BLOCK_BYTES) {
      diagnostics.push({ code: "managed_block_too_large", range: block.contentRange, blockId: block.blockId });
    }
    if (completedIds.has(block.blockId)) {
      diagnostics.push({ code: "duplicate_block_id", range: block.fullRange, blockId: block.blockId });
    }
    completedIds.add(block.blockId);
    blocks.push(block);
    open = undefined;
  }
  if (open !== undefined) {
    diagnostics.push({ code: "unclosed_begin_marker", range: open.marker.byteRange, blockId: open.marker.blockId });
  }
  if (new Set(blocks.map((block) => block.markerFamily)).size > 1) {
    diagnostics.push({ code: "mixed_marker_families" });
  }

  const status = diagnostics.length === 0 ? "valid" : "invalid";
  return {
    parserId: "lervo/commonmark-managed-blocks",
    parserVersion: "1.0.0",
    status,
    byteCount: bytes.byteLength,
    blocks,
    unmanagedRanges: status === "valid" ? unmanagedRanges(bytes.byteLength, blocks) : [],
    ignoredMarkers,
    diagnostics,
  };
}
