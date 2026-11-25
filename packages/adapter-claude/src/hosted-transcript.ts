import { createReadStream } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";

import type { HostedDecodedContent, HostedTranscriptItem } from "@lervo/adapter-contract";

import { compacted, peerMessage } from "./hosted-stream.js";
import { claudeShellOutput, claudeToolDetail, type ClaudeToolCall } from "./hosted-tool-detail.js";

/** A line longer than this is skipped, so one bad line cannot grow memory. */
const MAX_LINE_CHARACTERS = 16 * 1024 * 1024;
const MAX_TOOL_NAME_CHARACTERS = 64;
const COMMAND_NAME = /<command-name>\/?([^<]{1,200})<\/command-name>/u;
const COMMAND_ARGS = /<command-args>([\s\S]*?)<\/command-args>/u;
const COMMAND_OUTPUT = /^\s*<local-command-(?:stdout|stderr)>/u;

/**
 * What the person typed, for a line Claude Code records for a slash command: the command and its
 * arguments, as the live conversation shows the message sent. A command's local output is for
 * the terminal and is no message, so it reads as nothing; any other text stays as it is.
 */
export function typedText(value: string): string | undefined {
  if (COMMAND_OUTPUT.test(value)) return undefined;
  const name = COMMAND_NAME.exec(value)?.[1]?.trim();
  if (name === undefined) return value;
  const args = COMMAND_ARGS.exec(value)?.[1]?.trim() ?? "";
  return args.length === 0 ? `/${name}` : `/${name} ${args}`;
}

type Line = Record<string, unknown>;

function record(value: unknown): Line | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Line)
    : undefined;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/**
 * Where Claude Code keeps a session's transcript: `projects/<directory>/<session>.jsonl` under
 * its configuration directory, where `<directory>` is the working directory with every character
 * other than a letter or a digit replaced by `-`.
 */
export function claudeTranscriptPath(
  session: { readonly sessionId: string; readonly workingDirectory: string },
  environment: NodeJS.ProcessEnv = process.env,
): string {
  const configuration = environment.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude");
  const directory = session.workingDirectory.replaceAll(/[^A-Za-z0-9]/gu, "-");
  return join(configuration, "projects", directory, `${session.sessionId}.jsonl`);
}

/**
 * Decodes Claude Code's transcript into the items the native conversation shows, as the stream
 * decoder does for a live session: the person's messages, the agent's text, and one tool-activity
 * item per tool result with the same detail, and the `context_compacted` notice where Claude Code
 * compacted the conversation. Subagent lines, meta lines, thinking, and the compaction's summary
 * for the model are not part of the conversation.
 */
export class ClaudeTranscriptDecoder {
  /** Calls whose result has not been read, by tool use ID. */
  private readonly tools = new Map<string, ClaudeToolCall>();

  constructor(private readonly home: string | undefined = homedir()) {}

  line(source: string): HostedTranscriptItem[] {
    if (source.length > MAX_LINE_CHARACTERS) return [];
    let line: Line | undefined;
    try {
      line = record(JSON.parse(source));
    } catch {
      return [];
    }
    // A message another session sent is a meta line with the sender in its origin.
    const peer = line === undefined ? undefined : peerMessage(record(line.origin));
    if (peer !== undefined) {
      const at = Date.parse(text(line?.timestamp) ?? "");
      return Number.isNaN(at) ? [] : [item(peer, at)];
    }
    // The summary Claude Code writes after a compaction is for the model, not the conversation.
    if (
      line === undefined ||
      line.isSidechain === true ||
      line.isMeta === true ||
      line.isCompactSummary === true ||
      line.isVisibleInTranscriptOnly === true
    )
      return [];
    const createdAtMs = Date.parse(text(line.timestamp) ?? "");
    if (Number.isNaN(createdAtMs)) return [];
    const message = record(line.message);
    const content = message?.content;
    if (line.type === "user")
      return this.user(content, createdAtMs, {
        workingDirectory: text(line.cwd),
        structured: line.toolUseResult,
      });
    if (line.type === "assistant") return this.assistant(content, createdAtMs);
    if (line.type === "system" && line.subtype === "compact_boundary")
      return [item(compacted(record(line.compactMetadata)?.trigger), createdAtMs)];
    return [];
  }

  private user(
    content: unknown,
    createdAtMs: number,
    context: { readonly workingDirectory: string | undefined; readonly structured: unknown },
  ): HostedTranscriptItem[] {
    if (typeof content === "string") {
      const typed = typedText(content);
      return typed === undefined || typed.trim().length === 0
        ? []
        : [item({ kind: "user_message", text: typed }, createdAtMs)];
    }
    if (!Array.isArray(content)) return [];
    const items: HostedTranscriptItem[] = [];
    const words: string[] = [];
    const blocks = content.map(record).filter((block): block is Line => block !== undefined);
    const results = blocks.filter((block) => block.type === "tool_result").length;
    for (const block of blocks) {
      const value = text(block.text);
      const typed = value === undefined ? undefined : typedText(value);
      if (block.type === "text" && typed !== undefined) words.push(typed);
      if (block.type !== "tool_result") continue;
      const id = text(block.tool_use_id);
      const call = id === undefined ? undefined : this.tools.get(id);
      if (id === undefined || call === undefined) continue;
      this.tools.delete(id);
      const failed = block.is_error === true;
      // The structured result belongs to the line's only result.
      const result = {
        content: block.content,
        failed,
        structured: results === 1 ? context.structured : undefined,
      };
      const detail = claudeToolDetail(call, result, {
        workingDirectory: context.workingDirectory,
        home: this.home,
      });
      const output = claudeShellOutput(detail, result);
      items.push(
        item(
          {
            kind: "tool_activity",
            name: call.name.slice(0, MAX_TOOL_NAME_CHARACTERS),
            status: failed ? "failed" : "succeeded",
            calls: 1,
            ...(detail === undefined ? {} : { detail }),
            ...(output === undefined ? {} : { output }),
          },
          createdAtMs,
        ),
      );
    }
    const said = words.join("\n\n");
    if (said.trim().length > 0)
      items.unshift(item({ kind: "user_message", text: said }, createdAtMs));
    return items;
  }

  private assistant(content: unknown, createdAtMs: number): HostedTranscriptItem[] {
    if (!Array.isArray(content)) return [];
    const items: HostedTranscriptItem[] = [];
    for (const block of content.map(record)) {
      if (block === undefined) continue;
      if (block.type === "tool_use") {
        const id = text(block.id);
        const name = text(block.name);
        if (id !== undefined && name !== undefined)
          this.tools.set(id, { name, input: block.input });
      }
      const value = text(block.text);
      if (block.type === "text" && value !== undefined && value.trim().length > 0)
        items.push(item({ kind: "agent_message", text: value }, createdAtMs));
    }
    return items;
  }
}

function item(content: HostedDecodedContent, createdAtMs: number): HostedTranscriptItem {
  return { content, createdAtMs };
}

/** The session's transcript items, oldest first; none when Claude Code kept no transcript. */
export async function* readClaudeTranscript(
  session: { readonly sessionId: string; readonly workingDirectory: string },
  environment: NodeJS.ProcessEnv = process.env,
): AsyncGenerator<HostedTranscriptItem> {
  const stream = createReadStream(claudeTranscriptPath(session, environment), "utf8");
  const missing = new Promise<boolean>((resolve) => {
    stream.once("error", () => resolve(true));
    stream.once("open", () => resolve(false));
  });
  if (await missing) return;
  const decoder = new ClaudeTranscriptDecoder();
  for await (const line of createInterface({ input: stream, crlfDelay: Infinity }))
    yield* decoder.line(line);
}
