import { createReadStream } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";

import type { HostedDecodedContent, HostedTranscriptItem } from "@lervo/adapter-contract";

/** A line longer than this is skipped, so one bad line cannot grow memory. */
const MAX_LINE_CHARACTERS = 16 * 1024 * 1024;
const MAX_TOOL_NAME_CHARACTERS = 64;

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
 * item per tool result. Subagent lines, meta lines, thinking, and tool inputs and outputs are not
 * part of the conversation.
 */
export class ClaudeTranscriptDecoder {
  private readonly toolNames = new Map<string, string>();

  line(source: string): HostedTranscriptItem[] {
    if (source.length > MAX_LINE_CHARACTERS) return [];
    let line: Line | undefined;
    try {
      line = record(JSON.parse(source));
    } catch {
      return [];
    }
    if (line === undefined || line.isSidechain === true || line.isMeta === true) return [];
    const createdAtMs = Date.parse(text(line.timestamp) ?? "");
    if (Number.isNaN(createdAtMs)) return [];
    const message = record(line.message);
    const content = message?.content;
    if (line.type === "user") return this.user(content, createdAtMs);
    if (line.type === "assistant") return this.assistant(content, createdAtMs);
    return [];
  }

  private user(content: unknown, createdAtMs: number): HostedTranscriptItem[] {
    if (typeof content === "string")
      return content.trim().length === 0
        ? []
        : [item({ kind: "user_message", text: content }, createdAtMs)];
    if (!Array.isArray(content)) return [];
    const items: HostedTranscriptItem[] = [];
    const words: string[] = [];
    for (const block of content.map(record)) {
      if (block === undefined) continue;
      const value = text(block.text);
      if (block.type === "text" && value !== undefined) words.push(value);
      if (block.type !== "tool_result") continue;
      const id = text(block.tool_use_id);
      const name = id === undefined ? undefined : this.toolNames.get(id);
      if (id === undefined || name === undefined) continue;
      this.toolNames.delete(id);
      items.push(
        item(
          {
            kind: "tool_activity",
            name: name.slice(0, MAX_TOOL_NAME_CHARACTERS),
            status: block.is_error === true ? "failed" : "succeeded",
            calls: 1,
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
        if (id !== undefined && name !== undefined) this.toolNames.set(id, name);
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
