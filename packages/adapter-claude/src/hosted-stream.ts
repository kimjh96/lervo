import {
  type HostedDecodedContent,
  type HostedDecodedEvent,
  type HostedStreamDecoder,
  type HostedTurnUsage,
  type HostedUsageReporting,
  usageModelName,
} from "@lervo/adapter-contract";
import type { ResourceAccountingDescriptor } from "@lervo/schemas";

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
 *   Its per-model usage since the previous result is kept for `takeUsage`, never shown.
 * - Subagent messages, thinking, hooks, and system lines are not part of the conversation.
 */
export class ClaudeHostedStreamDecoder implements HostedStreamDecoder, HostedUsageReporting {
  private readonly decoder = new TextDecoder();
  private partial = "";
  private dropping = false;
  private inTurn = false;
  /** The index of the text block that is streaming, if any. */
  private streamingBlock: number | null = null;
  /** Whether the current assistant message streamed its text, so the full copy is a repeat. */
  private streamedText = false;
  private readonly toolNames = new Map<string, string>();
  /** Finished turns' usage that the caller has not taken yet. */
  private usage: HostedTurnUsage[] = [];
  /** The model of the turn's last assistant message, for a result without per-model usage. */
  private lastModel: string | undefined;

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
        this.lastModel = text(record(line.message)?.model) ?? this.lastModel;
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
    this.usage.push(...turnUsage(line, this.lastModel));
    events.push({ kind: "status", event: "turn_finished" });
    return events;
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

const count = (value: unknown): number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : 0;
const optionalCount = (value: unknown): number | null =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
const positiveCount = (value: unknown): number | null =>
  typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : null;

/**
 * How Claude Code counts the usage this decoder reports: each result's per-model delta since the
 * previous result, from `model_usage_since_last_result`, or the turn's own `usage` from an older
 * Claude Code. The core stores this descriptor once before the first record citing it.
 */
export const CLAUDE_HOSTED_USAGE_ACCOUNTING: ResourceAccountingDescriptor = {
  kind: "resource_accounting_descriptor",
  schemaVersion: 2,
  provider: "claude",
  adapterId: "claude/hosted-session",
  adapterVersion: "1",
  accountingMode: "operation_delta",
  observationSupport: "supported",
  unavailableReason: null,
  normalizationId: "claude.hosted.result-usage.v1",
  nativeCounterSemanticsId: "claude.stream-json.model-usage-since-last-result.v1",
  requestedModel: null,
  serviceTier: null,
};

/**
 * A result's usage: one record per model from `model_usage_since_last_result`, whose amounts sum
 * to the process's cumulative totals, or, from an older Claude Code, one record from the turn's
 * `usage` without a cost. A result without a UUID, or without either, reports nothing.
 */
function turnUsage(line: Line, lastModel: string | undefined): HostedTurnUsage[] {
  const turnKey = text(line.uuid);
  if (turnKey === undefined) return [];
  const resultIndex = count(line.result_index);
  const perModel = record(line.model_usage_since_last_result);
  if (perModel !== undefined)
    return Object.entries(perModel).flatMap(([key, value]) => {
      const stats = record(value);
      if (stats === undefined) return [];
      const cost =
        typeof stats.costUSD === "number" && Number.isFinite(stats.costUSD) && stats.costUSD >= 0
          ? stats.costUSD
          : null;
      return [
        {
          turnKey,
          resultIndex,
          modelKey: key,
          model: usageModelName(text(stats.canonicalModel) ?? key),
          uncachedInputTokens: count(stats.inputTokens),
          cacheReadInputTokens: count(stats.cacheReadInputTokens),
          cacheCreationInputTokens: count(stats.cacheCreationInputTokens),
          outputTokens: count(stats.outputTokens),
          reasoningOutputTokens: optionalCount(stats.thinkingTokens),
          contextWindow: positiveCount(stats.contextWindow),
          costUsd: cost,
          costBasis: cost === null ? ("unreported" as const) : ("list" as const),
        },
      ];
    });
  const usage = record(line.usage);
  if (usage === undefined) return [];
  return [
    {
      turnKey,
      resultIndex,
      modelKey: lastModel ?? "",
      model: usageModelName(lastModel),
      uncachedInputTokens: count(usage.input_tokens),
      cacheReadInputTokens: count(usage.cache_read_input_tokens),
      cacheCreationInputTokens: count(usage.cache_creation_input_tokens),
      outputTokens: count(usage.output_tokens),
      reasoningOutputTokens: optionalCount(record(usage.output_tokens_details)?.thinking_tokens),
      contextWindow: null,
      costUsd: null,
      costBasis: "unreported",
    },
  ];
}
