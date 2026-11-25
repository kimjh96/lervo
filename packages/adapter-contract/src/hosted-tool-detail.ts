// The bounded detail of one tool call in the native conversation (ADE session-host protocol, "Tool
// detail"). Provider adapters map their own tools to it; these helpers keep every detail within
// the protocol's bounds, so a page of tool lines stays well within one frame.

/** Characters of a subject at most; a longer one ends with an ellipsis. */
export const MAX_TOOL_SUBJECT_CHARACTERS = 512;
/** Lines of a preview at most. */
export const MAX_TOOL_PREVIEW_LINES = 24;
/** Characters of one preview line at most; a longer one ends with an ellipsis. */
export const MAX_TOOL_PREVIEW_LINE_CHARACTERS = 240;
/** Characters of all preview lines together at most. */
export const MAX_TOOL_PREVIEW_CHARACTERS = 1536;
/**
 * Characters of a shell call's output an adapter passes to the core within its process, so the
 * core can read what a Lervo command printed. It never reaches the session host.
 */
export const MAX_TOOL_OUTPUT_CHARACTERS = 65_536;

const ELLIPSIS = "…";
/** Lines a long output keeps from its start; the rest of the budget goes to its end. */
const OUTPUT_HEAD_LINES = 6;

export type HostedToolSubjectKind = "path" | "command" | "pattern" | "query" | "url" | "text";

export interface HostedToolCounts {
  readonly lines?: number;
  readonly matches?: number;
  readonly files?: number;
  readonly added?: number;
  readonly removed?: number;
}

export interface HostedToolPreview {
  readonly format: "output" | "diff";
  readonly lines: readonly string[];
  /** Lines left out, before the line at index `omittedAt`. */
  readonly omittedLines: number;
  readonly omittedAt: number;
}

export interface HostedToolDetail {
  readonly subject: { readonly kind: HostedToolSubjectKind; readonly text: string };
  readonly counts?: HostedToolCounts;
  /** The Lervo command a shell call ran. The core adds it; provider adapters never do. */
  readonly lervo?: {
    readonly command: string;
    readonly flag?: "help" | "version";
    readonly subject?: string;
    readonly found?: number;
    readonly hits?: readonly {
      readonly title: string;
      readonly path: string;
      readonly freshness: "current" | "stale" | "unknown";
    }[];
  };
  readonly preview?: HostedToolPreview;
}

function shortened(text: string, characters: number): string {
  const units = [...text];
  return units.length <= characters
    ? text
    : `${units.slice(0, characters - 1).join("")}${ELLIPSIS}`;
}

/** A subject within its bound, or undefined for empty text. */
export function toolSubject(
  kind: HostedToolSubjectKind,
  text: string | undefined,
): HostedToolDetail["subject"] | undefined {
  const value = text?.trim();
  if (value === undefined || value.length === 0) return undefined;
  return { kind, text: shortened(value, MAX_TOOL_SUBJECT_CHARACTERS) };
}

/** Lines of `text` without a final empty line. */
export function textLines(text: string): string[] {
  const lines = text.replace(/\r\n?/gu, "\n").split("\n");
  if (lines.at(-1) === "") lines.pop();
  return lines;
}

/**
 * A preview of `lines`. An output keeps its first few lines and as many of its last as fit,
 * where errors and summaries appear; a diff keeps its start. Long lines end with an ellipsis.
 */
export function toolPreview(
  format: HostedToolPreview["format"],
  lines: readonly string[],
): HostedToolPreview | undefined {
  if (lines.length === 0) return undefined;
  const fitted = lines.map((line) => shortened(line, MAX_TOOL_PREVIEW_LINE_CHARACTERS));
  const size = (part: readonly string[]) => part.reduce((sum, line) => sum + [...line].length, 0);
  let head: string[];
  let tail: string[];
  if (fitted.length <= MAX_TOOL_PREVIEW_LINES && size(fitted) <= MAX_TOOL_PREVIEW_CHARACTERS) {
    head = fitted;
    tail = [];
  } else if (format === "diff") {
    head = fitted.slice(0, MAX_TOOL_PREVIEW_LINES);
    tail = [];
    while (head.length > 1 && size(head) > MAX_TOOL_PREVIEW_CHARACTERS) head.pop();
  } else {
    head = fitted.slice(0, OUTPUT_HEAD_LINES);
    tail = fitted.slice(OUTPUT_HEAD_LINES).slice(-(MAX_TOOL_PREVIEW_LINES - OUTPUT_HEAD_LINES));
    // Within the character budget the end matters more: the start gives way first.
    while (head.length > 0 && size(head) + size(tail) > MAX_TOOL_PREVIEW_CHARACTERS) head.pop();
    while (tail.length > 1 && size(tail) > MAX_TOOL_PREVIEW_CHARACTERS) tail.shift();
  }
  return {
    format,
    lines: [...head, ...tail],
    omittedLines: fitted.length - head.length - tail.length,
    omittedAt: head.length,
  };
}

/**
 * `path` as the conversation shows it: relative to the workspace when inside it, from the home
 * directory as `~/…` when inside that, and unchanged otherwise.
 */
export function displayPath(
  path: string,
  places: { readonly workingDirectory: string | undefined; readonly home: string | undefined },
): string {
  for (const [root, prefix] of [
    [places.workingDirectory, ""],
    [places.home, "~/"],
  ] as const) {
    if (root === undefined || root.length === 0) continue;
    const base = root.endsWith("/") ? root : `${root}/`;
    if (path.startsWith(base) && path.length > base.length)
      return `${prefix}${path.slice(base.length)}`;
  }
  return path;
}
