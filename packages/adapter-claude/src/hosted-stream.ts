import {
  type HostedDecodedContent,
  type HostedDecodedEvent,
  type HostedImageSending,
  type HostedSentImage,
  type HostedStreamDecoder,
  type HostedTurnInterrupting,
  type HostedTurnUsage,
  type HostedUsageReporting,
  imageMark,
  type HostedQuestionAnswering,
} from "@lervo/adapter-contract";
import type { ResourceAccountingDescriptor } from "@lervo/schemas";
import { homedir } from "node:os";

import {
  claudeShellOutput,
  claudeToolAddsLine,
  claudeToolDetail,
  type ClaudeToolCall,
} from "./hosted-tool-detail.js";
import { ClaudeQuestions } from "./hosted-questions.js";
import { compacted, peerMessage } from "./hosted-stream-items.js";
import { CLAUDE_HOSTED_USAGE_ACCOUNTING, turnUsage } from "./hosted-usage.js";
import { asRecord } from "./normalization-utils.js";

/** A line longer than this is dropped up to its end, so one bad line cannot grow memory. */
const MAX_LINE_CHARACTERS = 16 * 1024 * 1024;
const MAX_TOOL_NAME_CHARACTERS = 64;
const MAX_PARAMETER_CHARACTERS = 256;
/** The status that returns a turn to work after the person answered its question. */
const RESUMED: HostedDecodedEvent = { kind: "status", event: "turn_started" };

type Line = Record<string, unknown>;

function text(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function blocks(line: Line): Line[] {
  const content = asRecord(line.message)?.content;
  return Array.isArray(content)
    ? content.map(asRecord).filter((block): block is Line => block !== undefined)
    : [];
}

/**
 * Decodes Claude Code's `stream-json` output with partial messages into conversation events.
 *
 * - Text blocks stream: `content_block_start` starts an agent message, `text_delta` extends it,
 *   and `content_block_stop` completes it.
 * - A tool call becomes one tool-activity item when its result arrives, succeeded or failed, with
 *   a bounded detail of what it acted on and showed. Paths show relative to the session's working
 *   directory, which the `system` `init` line names.
 * - `result` ends the turn. A turn the user stopped adds the `turn_stopped` notice, and any other
 *   turn that did not succeed adds the `provider_turn_failed` notice.
 *   Its per-model usage since the previous result is kept for `takeUsage`, never shown.
 * - Replayed user messages (`--replay-user-messages`) repeat the person's own, which `send`
 *   already showed; one another session sent becomes that session's message.
 * - A `compact_boundary` line, where Claude Code compacted the conversation, adds the
 *   `context_compacted` notice. Subagent messages, thinking, hooks, and other system lines are not
 *   part of the conversation.
 */
/** Claude Code's placeholders for `count` images, as its terminal writes them into a prompt. */
export function imagePlaceholders(count: number): string {
  return Array.from({ length: count }, (_, index) => `[Image #${index + 1}]`).join(" ");
}

export class ClaudeHostedStreamDecoder
  implements
    HostedStreamDecoder,
    HostedUsageReporting,
    HostedTurnInterrupting,
    HostedImageSending,
    HostedQuestionAnswering
{
  private readonly decoder = new TextDecoder();
  private partial = "";
  private dropping = false;
  private inTurn = false;
  /** The index of the text block that is streaming, if any. */
  private streamingBlock: number | null = null;
  /** Whether the current assistant message streamed its text, so the full copy is a repeat. */
  private streamedText = false;
  /** Calls whose result has not arrived, by tool use ID. */
  private readonly tools = new Map<string, ClaudeToolCall>();
  /** The session's working directory, from the `system` `init` line. */
  private workingDirectory: string | undefined;
  /** Whether the user asked to stop the running turn, so its end says it was stopped. */
  private interrupting = false;
  private interruptions = 0;
  /** Finished turns' usage that the caller has not taken yet. */
  private usage: HostedTurnUsage[] = [];
  /** The model of the turn's last assistant message, for a result without per-model usage. */
  private lastModel: string | undefined;
  /** The questions Claude Code asks with choices, and its other control requests. */
  private readonly questions = new ClaudeQuestions();

  constructor(
    private readonly now: () => number = Date.now,
    private readonly home: string | undefined = homedir(),
  ) {}

  send(value: string): { input: Uint8Array; events: HostedDecodedEvent[] } {
    return this.sendWithImages(value, []);
  }

  /**
   * The message as one stream-json user line: the text, then each image as Base64. Images alone
   * carry Claude Code's own placeholders, "[Image #1]", as their text, as its terminal does, so
   * prompt hooks and Lervo's retrieval read a prompt. The conversation still shows the images
   * alone.
   */
  sendWithImages(
    value: string,
    images: readonly HostedSentImage[],
  ): { input: Uint8Array; events: HostedDecodedEvent[] } {
    const said = value.length > 0 ? value : imagePlaceholders(images.length);
    const content = [
      ...(said.length === 0 ? [] : [{ type: "text", text: said }]),
      ...images.map((image) => ({
        type: "image",
        source: { type: "base64", media_type: image.mediaType, data: image.data },
      })),
    ];
    const line = JSON.stringify({ type: "user", message: { role: "user", content } });
    // A message written while a question waits answers it in prose, and the turn goes on.
    const resumes = this.inTurn && this.questions.waiting();
    this.questions.settleOpen();
    const settled = this.questions.takeReplies();
    const marks = images.map(imageMark);
    const events: HostedDecodedEvent[] = [
      {
        kind: "item",
        content: {
          kind: "user_message",
          text: value,
          ...(marks.length === 0 ? {} : { images: marks }),
        },
        createdAtMs: this.now(),
      },
    ];
    events.push(...(resumes ? [RESUMED] : this.startTurn()));
    return { input: new TextEncoder().encode(`${settled}${line}\n`), events };
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
      line = asRecord(JSON.parse(source));
    } catch {
      return [];
    }
    if (line === undefined) return [];
    if (line.parent_tool_use_id !== null && line.parent_tool_use_id !== undefined) return [];
    switch (line.type) {
      case "stream_event":
        return this.streamEvent(asRecord(line.event));
      case "assistant":
        this.lastModel = text(asRecord(line.message)?.model) ?? this.lastModel;
        return this.assistant(line);
      case "user":
        // With replayed user messages, the person's own messages repeat what `send` showed; a
        // message another session sent shows as that session's message.
        if (line.isReplay === true) {
          const message = peerMessage(asRecord(line.origin));
          return message === undefined ? [] : [this.item(message)];
        }
        return this.toolResults(line);
      case "result":
        return this.result(line);
      case "control_request": {
        const asked = this.questions.request(line);
        return asked === null
          ? []
          : [this.item(asked), { kind: "status", event: "question_asked" }];
      }
      case "system":
        if (line.subtype === "init")
          this.workingDirectory = text(line.cwd) ?? this.workingDirectory;
        if (line.subtype === "compact_boundary")
          return [this.item(compacted(asRecord(line.compact_metadata)?.trigger))];
        return [];
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
        const block = asRecord(event.content_block);
        if (block?.type === "tool_use") {
          const id = text(block.id);
          const name = text(block.name);
          // The input streams in; the full assistant message that follows carries it whole.
          if (id !== undefined && name !== undefined && !this.tools.has(id))
            this.tools.set(id, { name, input: {} });
          return [];
        }
        if (block?.type !== "text" || index === null) return [];
        this.streamingBlock = index;
        this.streamedText = true;
        return [this.started({ kind: "agent_message", text: text(block.text) ?? "" })];
      }
      case "content_block_delta": {
        const delta = asRecord(event.delta);
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
        if (id !== undefined && name !== undefined)
          this.tools.set(id, { name, input: block.input });
      }
      const value = text(block.text);
      if (block.type === "text" && !this.streamedText && value)
        events.push(this.item({ kind: "agent_message", text: value }));
    }
    return events;
  }

  private toolResults(line: Line): HostedDecodedEvent[] {
    const events: HostedDecodedEvent[] = [];
    const results = blocks(line).filter((block) => block.type === "tool_result");
    for (const block of results) {
      const id = text(block.tool_use_id);
      const call = id === undefined ? undefined : this.tools.get(id);
      if (id === undefined || call === undefined) continue;
      this.tools.delete(id);
      // The question and the person's answer already show what the call did.
      if (this.questions.showed(id) || !claudeToolAddsLine(call.name)) continue;
      const failed = block.is_error === true;
      // The structured result belongs to the line's only result.
      const result = {
        content: block.content,
        failed,
        structured: results.length === 1 ? line.tool_use_result : undefined,
      };
      const detail = claudeToolDetail(call, result, {
        workingDirectory: this.workingDirectory,
        home: this.home,
      });
      const output = claudeShellOutput(detail, result);
      events.push(
        this.item({
          kind: "tool_activity",
          name: call.name.slice(0, MAX_TOOL_NAME_CHARACTERS),
          status: failed ? "failed" : "succeeded",
          calls: 1,
          ...(detail === undefined ? {} : { detail }),
          ...(output === undefined ? {} : { output }),
          toolUseId: id,
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
    // A stopped turn ends as `aborted_streaming` or `aborted_tools`, the former as an error. A
    // Claude Code without `terminal_reason` is taken at the request, so a turn that finished
    // just before it arrived may show as stopped.
    const reason = text(line.terminal_reason);
    const stopped = reason === undefined ? this.interrupting : reason.startsWith("aborted_");
    this.interrupting = false;
    if (stopped)
      events.push(this.item({ kind: "lervo_notice", code: "turn_stopped", parameters: {} }));
    else if (line.subtype !== "success" || line.is_error === true)
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
    this.tools.clear();
    this.questions.forget();
    this.usage.push(...turnUsage(line, this.lastModel));
    events.push({ kind: "status", event: "turn_finished" });
    return events;
  }

  /** The person's answers to a question with choices, which show as their message. */
  answer(
    requestId: string,
    answers: Readonly<Record<string, string>>,
  ): { input: Uint8Array; events: HostedDecodedEvent[] } {
    const answered = this.questions.answer(requestId, answers);
    if (answered === null) return { input: new Uint8Array(), events: [] };
    // The turn the question paused goes on.
    return {
      input: new TextEncoder().encode(`${answered.line}\n`),
      events: [this.item({ kind: "user_message", text: answered.said }), RESUMED],
    };
  }

  /** The automatic answers to Claude Code's control requests, waiting to be written. */
  takeReplies(): Uint8Array {
    return new TextEncoder().encode(this.questions.takeReplies());
  }

  /**
   * Asks Claude Code to stop the running turn with a stream-json control request. Claude answers
   * with a `control_response` and ends the turn with its `result`, keeping the session, so the
   * next message continues it. With no turn running, nothing is sent.
   */
  interrupt(): { input: Uint8Array; events: HostedDecodedEvent[] } {
    if (!this.inTurn) return { input: new Uint8Array(), events: [] };
    this.interrupting = true;
    this.interruptions += 1;
    const line = JSON.stringify({
      type: "control_request",
      request_id: `lervo_interrupt_${this.interruptions}`,
      request: { subtype: "interrupt" },
    });
    return { input: new TextEncoder().encode(`${line}\n`), events: [] };
  }

  usageAccounting(): ResourceAccountingDescriptor {
    return CLAUDE_HOSTED_USAGE_ACCOUNTING;
  }

  takeUsage(): HostedTurnUsage[] {
    const taken = this.usage;
    this.usage = [];
    return taken;
  }

  private item(content: HostedDecodedContent): HostedDecodedEvent {
    return { kind: "item", content, createdAtMs: this.now() };
  }

  private started(content: HostedDecodedContent): HostedDecodedEvent {
    return { kind: "start", content, createdAtMs: this.now() };
  }
}
