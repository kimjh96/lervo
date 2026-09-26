import { ClaudeTurnUsageEstimator } from "./usage-estimate.js";
import type {
  AdapterNormalizedEvent,
  AdapterNormalizedEventType,
  AdapterSession,
} from "@lervo/schemas";

import {
  asRecord,
  cwdRelative,
  digest,
  eventTime,
  integer,
  text,
  toolResultBlocks,
} from "./normalization-utils.js";
import { ClaudeAdapterError } from "./types.js";

interface PendingTool {
  name: string;
  input: unknown;
  structuredOutputCarrier: boolean;
}

export interface ClaudeEventNormalizerOptions {
  session: AdapterSession;
  repositoryRoot: string;
  adapterVersion: string;
  now: () => Date;
  createEventId: () => string;
  activeProviderTurnId: () => string | undefined;
  structuredOutputCarrierEnabled: boolean;
}

export class ClaudeEventNormalizer {
  private readonly pendingTools = new Map<string, PendingTool>();
  private readonly startedProviderTurns = new Set<string>();
  private readonly usageEstimator = new ClaudeTurnUsageEstimator();
  private seenInit = false;

  constructor(private readonly options: ClaudeEventNormalizerOptions) {}

  failure(failureCode: string, diagnostic: unknown, retryable = false): AdapterNormalizedEvent {
    return this.providerError(failureCode, diagnostic, this.options.now().toISOString(), retryable);
  }

  normalize(raw: unknown): AdapterNormalizedEvent[] {
    const message = asRecord(raw);
    if (message === undefined) return [];
    const sessionId = text(message.session_id);
    if (sessionId !== undefined && sessionId !== this.options.session.providerSessionId) {
      throw new ClaudeAdapterError(
        "provider_protocol_failed",
        "The Claude event session ID does not match.",
      );
    }

    if (message.type === "system" && message.subtype === "init") {
      if (this.seenInit) return [];
      this.seenInit = true;
      return [
        this.event(
          "provider.session.started",
          { adapterVersion: this.options.adapterVersion },
          eventTime(message, this.options.now),
        ),
      ];
    }
    if (message.type === "system" && message.subtype === "compact_boundary") {
      const providerTurnId = this.options.activeProviderTurnId();
      const providerItemId = text(message.uuid);
      if (providerTurnId === undefined || providerItemId === undefined) {
        return [
          this.providerError("unbound_compaction", message, eventTime(message, this.options.now)),
        ];
      }
      return [
        this.event(
          "provider.context.compacted",
          { providerTurnId, providerItemId },
          eventTime(message, this.options.now),
        ),
      ];
    }
    if (message.type === "command_lifecycle" && message.state === "started") {
      const providerTurnId = this.options.activeProviderTurnId();
      const commandUuid = text(message.command_uuid);
      if (providerTurnId === undefined) return [];
      if (commandUuid !== providerTurnId) {
        return [
          this.providerError(
            "unbound_turn_start",
            message.state,
            eventTime(message, this.options.now),
          ),
        ];
      }
      return this.turnStarted(providerTurnId, message);
    }
    if (message.type === "user" && message.isReplay === true) {
      const providerTurnId = this.options.activeProviderTurnId();
      const uuid = text(message.uuid);
      return message.shouldQuery !== false &&
        providerTurnId !== undefined &&
        uuid === providerTurnId
        ? this.turnStarted(providerTurnId, message)
        : [];
    }
    if (message.type === "assistant") return this.assistant(message);
    if (message.type === "user") return this.toolResults(message);
    if (message.type === "result") return this.result(message);
    return [];
  }

  private turnStarted(
    providerTurnId: string,
    message: Record<string, unknown>,
  ): AdapterNormalizedEvent[] {
    if (this.startedProviderTurns.has(providerTurnId)) return [];
    this.startedProviderTurns.add(providerTurnId);
    return [
      this.event("provider.turn.started", { providerTurnId }, eventTime(message, this.options.now)),
    ];
  }

  private assistant(message: Record<string, unknown>): AdapterNormalizedEvent[] {
    if (message.parent_tool_use_id !== null && message.parent_tool_use_id !== undefined) {
      return [
        this.providerError(
          "unmanaged_subagent_signal",
          message.parent_tool_use_id,
          eventTime(message, this.options.now),
        ),
      ];
    }
    const providerError = text(message.error);
    if (providerError !== undefined) {
      return [
        this.providerError(
          `claude_${providerError}`,
          { error: providerError },
          eventTime(message, this.options.now),
          providerError === "rate_limit" ||
            providerError === "overloaded" ||
            providerError === "server_error",
        ),
      ];
    }
    const content = asRecord(message.message)?.content;
    if (!Array.isArray(content)) return [];
    for (const value of content) {
      const block = asRecord(value);
      const providerItemId = text(block?.id);
      const name = text(block?.name);
      if (block?.type === "tool_use" && providerItemId !== undefined && name !== undefined) {
        this.pendingTools.set(providerItemId, {
          name,
          input: block.input ?? null,
          structuredOutputCarrier:
            this.options.structuredOutputCarrierEnabled && name === "StructuredOutput",
        });
      }
    }
    return this.estimatedUsage(message);
  }

  private estimatedUsage(message: Record<string, unknown>): AdapterNormalizedEvent[] {
    const providerTurnId = this.options.activeProviderTurnId();
    const totalTokens =
      providerTurnId === undefined ? null : this.usageEstimator.observe(providerTurnId, message);
    return totalTokens === null
      ? []
      : [
          this.event(
            "provider.usage.estimated",
            { providerTurnId: providerTurnId!, totalTokens },
            eventTime(message, this.options.now),
          ),
        ];
  }

  private toolResults(message: Record<string, unknown>): AdapterNormalizedEvent[] {
    if (message.parent_tool_use_id !== null && message.parent_tool_use_id !== undefined) {
      return [
        this.providerError(
          "unmanaged_subagent_signal",
          message.parent_tool_use_id,
          eventTime(message, this.options.now),
        ),
      ];
    }
    return toolResultBlocks(message).flatMap((block) => this.completedTool(message, block));
  }

  private completedTool(
    message: Record<string, unknown>,
    block: Record<string, unknown>,
  ): AdapterNormalizedEvent[] {
    const providerItemId = text(block.tool_use_id);
    const pending =
      providerItemId === undefined ? undefined : this.pendingTools.get(providerItemId);
    if (providerItemId === undefined || pending === undefined) {
      return [
        this.providerError("unbound_tool_result", block, eventTime(message, this.options.now)),
      ];
    }
    this.pendingTools.delete(providerItemId);
    const status = block.is_error === true ? "failed" : "completed";
    const structured = asRecord(message.tool_use_result);
    const durationMs = integer(structured?.duration_ms ?? structured?.durationMs);
    if (pending.structuredOutputCarrier) {
      return [];
    }
    if (pending.name === "Bash") {
      const input = asRecord(pending.input);
      const command = text(input?.command);
      if (command === undefined) {
        return [
          this.providerError(
            "invalid_provider_command",
            pending.input,
            eventTime(message, this.options.now),
          ),
        ];
      }
      return [
        this.event(
          "provider.command.executed",
          {
            providerItemId,
            commandDigest: digest(command),
            cwdRelative: cwdRelative(this.options.repositoryRoot, input?.cwd),
            status,
            exitCode: integer(structured?.exitCode ?? structured?.exit_code),
            outputDigest: block.content === undefined ? null : digest(block.content),
            durationMs,
          },
          eventTime(message, this.options.now),
        ),
      ];
    }
    return [
      this.event(
        "provider.tool.called",
        {
          providerItemId,
          toolName: pending.name,
          inputDigest: digest(pending.input),
          status,
          durationMs,
        },
        eventTime(message, this.options.now),
      ),
    ];
  }

  private result(message: Record<string, unknown>): AdapterNormalizedEvent[] {
    const active = this.options.activeProviderTurnId();
    const reported = text(message.user_message_uuid);
    const providerTurnId = reported ?? active;
    if (
      providerTurnId === undefined ||
      (active !== undefined && reported !== undefined && reported !== active)
    ) {
      return [
        this.providerError(
          "unbound_turn_result",
          message.subtype,
          eventTime(message, this.options.now),
        ),
      ];
    }
    if (message.subtype === "success" && message.is_error === false) {
      const occurredAt = eventTime(message, this.options.now);
      const usage = this.usage(message, providerTurnId, occurredAt);
      return [
        ...(this.options.structuredOutputCarrierEnabled && message.structured_output === undefined
          ? [this.providerError("structured_output_missing", { providerTurnId }, occurredAt)]
          : []),
        usage,
        this.event(
          "provider.turn.completed",
          {
            providerTurnId,
            status: "completed",
            durationMs: integer(message.duration_ms),
          },
          occurredAt,
        ),
      ];
    }
    const subtype = text(message.subtype) ?? "unknown";
    // A turn that failed before any model answered, such as a contended OAuth refresh or an API
    // outage reported as a synthetic message, proves no model ran; like Codex, it is retryable.
    const modelUsage = asRecord(message.modelUsage);
    const modelObserved = modelUsage !== undefined && Object.keys(modelUsage).length > 0;
    return [
      this.event(
        "provider.turn.failed",
        {
          providerTurnId,
          failureCode: modelObserved
            ? `claude_${subtype}`.replaceAll(/[^a-z0-9_]/g, "_").slice(0, 64)
            : "provider_model_unavailable",
          diagnosticDigest: digest({ subtype, stopReason: message.stop_reason }),
        },
        eventTime(message, this.options.now),
      ),
    ];
  }

  private usage(
    message: Record<string, unknown>,
    providerTurnId: string,
    occurredAt: string,
  ): AdapterNormalizedEvent {
    const modelUsage = asRecord(message.modelUsage);
    const totals = {
      inputTokens: 0,
      cachedInputTokens: 0,
      outputTokens: 0,
      reasoningOutputTokens: 0,
      totalTokens: 0,
      contextWindow: null as number | null,
    };
    if (modelUsage === undefined || Object.keys(modelUsage).length === 0)
      return this.providerError("invalid_provider_usage", message.modelUsage, occurredAt);
    for (const value of Object.values(modelUsage)) {
      const row = asRecord(value);
      const inputTokens = integer(row?.inputTokens);
      const outputTokens = integer(row?.outputTokens);
      const cacheReadInputTokens = integer(row?.cacheReadInputTokens);
      const cacheCreationInputTokens = integer(row?.cacheCreationInputTokens);
      const contextWindow = integer(row?.contextWindow);
      if (
        inputTokens === null ||
        outputTokens === null ||
        cacheReadInputTokens === null ||
        cacheCreationInputTokens === null ||
        contextWindow === null ||
        [
          inputTokens,
          outputTokens,
          cacheReadInputTokens,
          cacheCreationInputTokens,
          contextWindow,
        ].some((count) => count < 0)
      ) {
        return this.providerError("invalid_provider_usage", message.modelUsage, occurredAt);
      }
      const completeInputTokens = inputTokens + cacheReadInputTokens + cacheCreationInputTokens;
      totals.inputTokens += completeInputTokens;
      totals.cachedInputTokens += cacheReadInputTokens;
      totals.outputTokens += outputTokens;
      totals.totalTokens += completeInputTokens + outputTokens;
      totals.contextWindow = Math.max(totals.contextWindow ?? 0, contextWindow);
    }
    return this.event("provider.usage.updated", { providerTurnId, ...totals }, occurredAt);
  }

  private providerError(
    failureCode: string,
    diagnostic: unknown,
    occurredAt: string,
    retryable = false,
  ): AdapterNormalizedEvent {
    return this.event(
      "provider.error",
      { failureCode, diagnosticDigest: digest(diagnostic), retryable },
      occurredAt,
    );
  }

  private event(
    type: AdapterNormalizedEventType,
    payload: Record<string, unknown>,
    occurredAt: string,
  ): AdapterNormalizedEvent {
    const session = this.options.session;
    return {
      kind: "normalized_event",
      schemaVersion: 1,
      eventId: this.options.createEventId(),
      projectId: session.projectId,
      runId: session.runId,
      sessionId: session.sessionId,
      providerSessionId: session.providerSessionId,
      type,
      occurredAt,
      payload,
    };
  }
}
