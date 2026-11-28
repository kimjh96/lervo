// Claude Code's tool calls as the native conversation's tool detail (ADE session-host protocol,
// "Tool detail"). The live stream and the transcript both pass a call's input, its `tool_result`,
// and Claude Code's structured result, so a rebuilt conversation shows what the live one showed.
import {
  displayPath,
  MAX_TOOL_OUTPUT_CHARACTERS,
  type HostedToolCounts,
  type HostedToolDetail,
  textLines,
  toolPreview,
  toolSubject,
} from "@lervo/adapter-contract";

type Fields = Record<string, unknown>;

function fields(value: unknown): Fields | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Fields)
    : undefined;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function count(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

/** Where a call's paths are shown from. */
export interface ToolPlaces {
  readonly workingDirectory: string | undefined;
  readonly home: string | undefined;
}

export interface ClaudeToolCall {
  readonly name: string;
  readonly input: unknown;
}

export interface ClaudeToolResult {
  /** The `tool_result` block's content: a string or text blocks. */
  readonly content: unknown;
  readonly failed: boolean;
  /** Claude Code's structured result, `tool_use_result` or the transcript's `toolUseResult`. */
  readonly structured: unknown;
}

/** The text of a `tool_result` content: a string, or its text blocks joined. */
function resultText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((block) => text(fields(block)?.text))
    .filter((value): value is string => value !== undefined)
    .join("\n");
}

/**
 * A shell call's output for the core within the resident process, bounded; other tools pass none.
 * The core reads what a Lervo command printed from it.
 */
export function claudeShellOutput(
  detail: HostedToolDetail | undefined,
  result: ClaudeToolResult,
): string | undefined {
  if (detail?.subject.kind !== "command") return undefined;
  return resultText(result.content).slice(0, MAX_TOOL_OUTPUT_CHARACTERS);
}

/** Lines with the workspace's path stripped where they start with it, as file lists do. */
function relativeLines(lines: readonly string[], places: ToolPlaces): string[] {
  return lines.map((line) => displayPath(line, places));
}

/** Counts that are present, or undefined when none is. */
function counts(values: HostedToolCounts): HostedToolCounts | undefined {
  const present = Object.fromEntries(
    Object.entries(values).filter(([, value]) => value !== undefined),
  ) as HostedToolCounts;
  return Object.keys(present).length === 0 ? undefined : present;
}

/** Diff lines from Claude Code's `structuredPatch` hunks, with a header per hunk. */
function patchLines(structured: Fields | undefined): string[] | undefined {
  const patch = structured?.structuredPatch;
  if (!Array.isArray(patch) || patch.length === 0) return undefined;
  const lines: string[] = [];
  for (const hunk of patch.map(fields)) {
    if (hunk === undefined || !Array.isArray(hunk.lines)) continue;
    const oldStart = count(hunk.oldStart);
    const newStart = count(hunk.newStart);
    if (oldStart !== undefined && newStart !== undefined)
      lines.push(
        `@@ -${oldStart},${count(hunk.oldLines) ?? 0} +${newStart},${count(hunk.newLines) ?? 0} @@`,
      );
    for (const line of hunk.lines) if (typeof line === "string") lines.push(line);
  }
  return lines.length === 0 ? undefined : lines;
}

/** Diff lines from an edit's old and new text, when no structured patch came. */
function replacementLines(edits: readonly Fields[]): string[] {
  return edits.flatMap((edit) => [
    ...textLines(text(edit.old_string) ?? "").map((line) => `-${line}`),
    ...textLines(text(edit.new_string) ?? "").map((line) => `+${line}`),
  ]);
}

function diffDetail(
  subject: HostedToolDetail["subject"] | undefined,
  lines: readonly string[],
): HostedToolDetail | undefined {
  if (subject === undefined) return undefined;
  const added = lines.filter((line) => line.startsWith("+")).length;
  const removed = lines.filter((line) => line.startsWith("-")).length;
  const preview = toolPreview("diff", lines);
  return {
    subject,
    ...(added + removed > 0 ? { counts: { added, removed } } : {}),
    ...(preview === undefined ? {} : { preview }),
  };
}

function withPreview(
  subject: HostedToolDetail["subject"] | undefined,
  lines: readonly string[],
  values: HostedToolCounts = {},
): HostedToolDetail | undefined {
  if (subject === undefined) return undefined;
  const preview = toolPreview("output", lines);
  const shown = counts(values);
  return {
    subject,
    ...(shown === undefined ? {} : { counts: shown }),
    ...(preview === undefined ? {} : { preview }),
  };
}

/**
 * Tools whose calls add no line. `Yield` only pauses the agent until its background work reports:
 * the agent's own words say what it waits for, and the working status shows the turn goes on.
 */
const LINELESS_TOOLS: ReadonlySet<string> = new Set(["Yield"]);

/** Whether a finished call of `name` reads as a tool line in the conversation. */
export function claudeToolAddsLine(name: string): boolean {
  return !LINELESS_TOOLS.has(name);
}

/**
 * The detail of one finished call, or undefined for a tool whose input names nothing to show.
 * A failed call previews its error.
 */
export function claudeToolDetail(
  call: ClaudeToolCall,
  result: ClaudeToolResult,
  places: ToolPlaces,
): HostedToolDetail | undefined {
  const input = fields(call.input) ?? {};
  const structured = fields(result.structured);
  const output = textLines(resultText(result.content));
  const path = (value: unknown) => {
    const raw = text(value);
    return raw === undefined ? undefined : toolSubject("path", displayPath(raw, places));
  };
  if (result.failed) {
    const subject =
      path(input.file_path ?? input.notebook_path) ??
      toolSubject("command", text(input.command)) ??
      toolSubject("pattern", text(input.pattern)) ??
      toolSubject("url", text(input.url)) ??
      toolSubject("query", text(input.query)) ??
      toolSubject("text", text(input.description));
    return withPreview(subject, output);
  }
  switch (call.name) {
    case "Read": {
      const subject = path(input.file_path);
      const lines = count(fields(structured?.file)?.numLines) ?? output.length;
      return subject === undefined ? undefined : { subject, counts: { lines } };
    }
    case "Write": {
      const content = textLines(text(input.content) ?? "");
      return diffDetail(
        path(input.file_path),
        content.map((line) => `+${line}`),
      );
    }
    case "Edit":
      return diffDetail(path(input.file_path), patchLines(structured) ?? replacementLines([input]));
    case "MultiEdit": {
      const edits = Array.isArray(input.edits)
        ? input.edits.map(fields).filter((edit): edit is Fields => edit !== undefined)
        : [];
      return diffDetail(path(input.file_path), patchLines(structured) ?? replacementLines(edits));
    }
    case "NotebookEdit": {
      const subject = path(input.notebook_path);
      return subject === undefined ? undefined : { subject };
    }
    case "Bash":
      return withPreview(toolSubject("command", text(input.command)), output);
    case "Grep": {
      const lines = relativeLines(
        output.filter((line) => !/^Found \d+ (files?|lines?|matches?)/u.test(line)),
        places,
      );
      const files = count(structured?.numFiles);
      const matches = count(structured?.numLines) ?? count(structured?.numMatches);
      const mode = text(input.output_mode) ?? "files_with_matches";
      return withPreview(
        toolSubject("pattern", text(input.pattern)),
        lines,
        mode === "files_with_matches"
          ? { files: files ?? lines.length }
          : { matches: matches ?? lines.length },
      );
    }
    case "Glob": {
      const lines = relativeLines(
        output.filter((line) => !line.startsWith("No files found")),
        places,
      );
      return withPreview(toolSubject("pattern", text(input.pattern)), lines, {
        files: count(structured?.numFiles) ?? lines.length,
      });
    }
    case "WebFetch":
      return withPreview(toolSubject("url", text(input.url)), []);
    case "WebSearch":
      return withPreview(toolSubject("query", text(input.query)), []);
    case "Task":
    case "Agent":
      return withPreview(toolSubject("text", text(input.description)), []);
    case "Skill":
      return withPreview(toolSubject("text", text(input.skill) ?? text(input.command)), []);
    default:
      return undefined;
  }
}
