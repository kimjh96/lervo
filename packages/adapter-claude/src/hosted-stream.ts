import type {
  HostedDecodedContent,
  HostedDecodedEvent,
  HostedStreamDecoder,
} from "@lervo/adapter-contract";

/** A line longer than this is dropped up to its end, so one bad line cannot grow memory. */
const MAX_LINE_CHARACTERS = 16 * 1024 * 1024;
const MAX_TOOL_NAME_CHARACTERS = 64;
const MAX_PARAMETER_CHARACTERS = 256;

type Line = Record<string, unknown>;

function record(value: unknown): Line | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Line)
    : undefined;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function blocks(line: Line): Line[] {
  const content = record(line.message)?.content;
  return Array.isArray(content)
    ? content.map(record).filter((block): block is Line => block !== undefined)
    : [];
}

/**
 * Decodes Claude Code's `stream-json` output with partial messages into conversation events.
 *
 * - Text blocks stream: `content_block_start` starts an agent message, `text_delta` extends it,
 *   and `content_block_stop` completes it.
 * - A tool call becomes one tool-activity item when its result arrives, succeeded or failed. Tool
 *   inputs and outputs never leave the decoder.
 * - `result` ends the turn. A turn that did not succeed adds the `provider_turn_failed` notice.
 * - Subagent messages, thinking, hooks, and system lines are not part of the conversation.
 */
export class ClaudeHostedStreamDecoder implements HostedStreamDecoder {
  private readonly decoder = new TextDecoder();
  private partial = "";
  private dropping = false;
  private inTurn = false;
  /** The index of the text block that is streaming, if any. */
  private streamingBlock: number | null = null;
  /** Whether the current assistant message streamed its text, so the full copy is a repeat. */
  private streamedText = false;
  private readonly toolNames = new Map<string, string>();

  constructor(private readonly now: () => number = Date.now) {}

  send(value: string): { input: Uint8Array; events: HostedDecodedEvent[] } {
    const line = JSON.stringify({
      type: "user",
      message: { role: "user", content: [{ type: "text", text: value }] },
    });
    const events: HostedDecodedEvent[] = [
      { kind: "item", content: { kind: "user_message", text: value }, createdAtMs: this.now() },
    ];
    events.push(...this.startTurn());
    return { input: new TextEncoder().encode(`${line}\n`), events };
  }

  output(chunk: Uint8Array): HostedDecodedEvent[] {
    const events: HostedDecodedEvent[] = [];
    let rest = this.decoder.decode(chunk, { stream: true });
    while (rest.length > 0) {
      const end = rest.indexOf("\n");
      const piece = end === -1 ? rest : rest.slice(0, end);
      rest = end === -1 ? "" : rest.slice(end + 1);
      if (!this.dropping) this.partial += piece;
      if (this.partial.length > MAX_LINE_CHARACTERS) {
        this.partial = "";
        this.dropping = true;
      }
      if (end === -1) break;
      const complete = this.partial;
      this.partial = "";
      if (this.dropping) {
        this.dropping = false;
        continue;
      }
      events.push(...this.line(complete));
    }
    return events;
  }

  private line(source: string): HostedDecodedEvent[] {
    let line: Line | undefined;
    try {
      line = record(JSON.parse(source));
    } catch {
      return [];
    }
    if (line === undefined) return [];
    if (line.parent_tool_use_id !== null && line.parent_tool_use_id !== undefined) return [];
    switch (line.type) {
      case "stream_event":
        return this.streamEvent(record(line.event));
      case "assistant":
        return this.assistant(line);
      case "user":
        return this.toolResults(line);
      case "result":
        return this.result(line);
      default:
        return [];
    }
  }

  private startTurn(): HostedDecodedEvent[] {
    if (this.inTurn) return [];
    this.inTurn = true;
    return [{ kind: "status", event: "turn_started" }];
  }

  private streamEvent(event: Line | undefined): HostedDecodedEvent[] {
    if (event === undefined) return [];
    const index = typeof event.index === "number" ? event.index : null;
    switch (event.type) {
      case "message_start":
        this.streamedText = false;
        return this.startTurn();
      case "content_block_start": {
        const block = record(event.content_block);
        if (block?.type === "tool_use") {
          const id = text(block.id);
          const name = text(block.name);
          if (id !== undefined && name !== undefined) this.toolNames.set(id, name);
          return [];
        }
        if (block?.type !== "text" || index === null) return [];
        this.streamingBlock = index;
        this.streamedText = true;
        return [this.started({ kind: "agent_message", text: text(block.text) ?? "" })];
      }
      case "content_block_delta": {
        const delta = record(event.delta);
        const value = text(delta?.text);
        if (delta?.type !== "text_delta" || index !== this.streamingBlock || !value) return [];
        return [{ kind: "delta", text: value }];
      }
      case "content_block_stop":
        if (index === null || index !== this.streamingBlock) return [];
        this.streamingBlock = null;
        return [{ kind: "finish" }];
      default:
        return [];
    }
  }

  /** The full assistant message. Its text repeats what streamed, unless nothing streamed. */
  private assistant(line: Line): HostedDecodedEvent[] {
    const events: HostedDecodedEvent[] = [];
    for (const block of blocks(line)) {
      if (block.type === "tool_use") {
        const id = text(block.id);
        const name = text(block.name);
        if (id !== undefined && name !== undefined) this.toolNames.set(id, name);
      }
      const value = text(block.text);
      if (block.type === "text" && !this.streamedText && value)
        events.push(this.item({ kind: "agent_message", text: value }));
    }
    return events;
  }

  private toolResults(line: Line): HostedDecodedEvent[] {
    const events: HostedDecodedEvent[] = [];
    for (const block of blocks(line)) {
      if (block.type !== "tool_result") continue;
      const id = text(block.tool_use_id);
      const name = id === undefined ? undefined : this.toolNames.get(id);
      if (id === undefined || name === undefined) continue;
      this.toolNames.delete(id);
      events.push(
        this.item({
          kind: "tool_activity",
          name: name.slice(0, MAX_TOOL_NAME_CHARACTERS),
          status: block.is_error === true ? "failed" : "succeeded",
          calls: 1,
        }),
      );
    }
    return events;
  }

  private result(line: Line): HostedDecodedEvent[] {
    const events: HostedDecodedEvent[] = [];
    if (this.streamingBlock !== null) {
      this.streamingBlock = null;
      events.push({ kind: "finish" });
    }
    if (line.subtype !== "success" || line.is_error === true)
      events.push(
        this.item({
          kind: "lervo_notice",
          code: "provider_turn_failed",
          parameters: {
            subtype: (text(line.subtype) ?? "unknown").slice(0, MAX_PARAMETER_CHARACTERS),
          },
        }),
      );
    this.inTurn = false;
    this.toolNames.clear();
    events.push({ kind: "status", event: "turn_finished" });
    return events;
  }

  private item(content: HostedDecodedContent): HostedDecodedEvent {
    return { kind: "item", content, createdAtMs: this.now() };
  }

  private started(content: HostedDecodedContent): HostedDecodedEvent {
    return { kind: "start", content, createdAtMs: this.now() };
  }
}
