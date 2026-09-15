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
  fileKind,
  integer,
  lifecycleStatus,
  nonNegativeInteger,
  providerThreadId,
  repositoryPath,
  text,
} from "./normalization-utils.js";

export interface CodexEventNormalizerOptions {
  session: AdapterSession;
  repositoryRoot: string;
  adapterVersion: string;
  now: () => Date;
  createEventId: () => string;
  /** Reports the model observed for this session, or null when the provider never named one. */
  observedModel?: () => string | null;
}

export class CodexEventNormalizer {
  private seenStarted = false;

  constructor(private readonly options: CodexEventNormalizerOptions) {}

  normalize(raw: unknown): AdapterNormalizedEvent | null {
    const message = asRecord(raw);
    const method = text(message?.method);
    const params = asRecord(message?.params);
    if (message === undefined || method === undefined || params === undefined) return null;
    const threadId = providerThreadId(method, params);
    if (threadId !== undefined && threadId !== this.options.session.providerSessionId) return null;

    if (method === "thread/started") {
      const restarted = this.seenStarted;
      this.seenStarted = true;
      return this.event(
        restarted ? "provider.session.restarted" : "provider.session.started",
        restarted ? { reason: "session_resumed" } : { adapterVersion: this.options.adapterVersion },
        eventTime(message, params, this.options.now),
      );
    }
    if (method === "thread/closed") {
      return this.event(
        "provider.session.stopped",
        { status: "unknown" },
        eventTime(message, params, this.options.now),
      );
    }
    if (method === "turn/started") {
      const turn = asRecord(params.turn);
      const providerTurnId = text(turn?.id);
      return providerTurnId === undefined
        ? null
        : this.event(
            "provider.turn.started",
            { providerTurnId },
            eventTime(message, params, this.options.now),
          );
    }
    if (method === "turn/completed") return this.completedTurn(message, params);
    if (method === "item/completed") return this.completedItem(message, params);
    if (method === "thread/tokenUsage/updated") return this.usage(message, params);
    if (method === "thread/compacted") {
      const providerTurnId = text(params.turnId);
      return providerTurnId === undefined
        ? null
        : this.event(
            "provider.context.compacted",
            { providerTurnId, providerItemId: `legacy-${providerTurnId}` },
            eventTime(message, params, this.options.now),
          );
    }
    if (method === "error") {
      return this.event(
        "provider.error",
        {
          failureCode: "codex_provider_error",
          diagnosticDigest: digest(params.error),
          retryable: params.willRetry === true,
        },
        eventTime(message, params, this.options.now),
      );
    }
    if (Object.hasOwn(message, "id")) {
      return this.event(
        "provider.error",
        {
          failureCode: "managed_request_declined",
          diagnosticDigest: digest({ method, params }),
          retryable: false,
        },
        eventTime(message, params, this.options.now),
      );
    }
    return null;
  }

  private completedTurn(
    message: Record<string, unknown>,
    params: Record<string, unknown>,
  ): AdapterNormalizedEvent | null {
    const turn = asRecord(params.turn);
    const providerTurnId = text(turn?.id);
    if (providerTurnId === undefined) return null;
    if (turn?.status === "failed") {
      // A turn that fails without the provider ever naming a model is a transient capacity or
      // availability result, not a rejected request. The code stays provider-neutral so the
      // run coordinator reads a contract code rather than a Codex-specific one.
      const modelObserved = this.options.observedModel?.() ?? null;
      return this.event(
        "provider.turn.failed",
        {
          providerTurnId,
          failureCode: modelObserved === null ? "provider_model_unavailable" : "codex_turn_failed",
          diagnosticDigest: digest(turn.error),
        },
        eventTime(message, params, this.options.now),
      );
    }
    if (turn?.status !== "completed" && turn?.status !== "interrupted") {
      return this.providerError("invalid_provider_turn", turn, message, params);
    }
    return this.event(
      "provider.turn.completed",
      {
        providerTurnId,
        status: turn.status,
        durationMs: integer(turn?.durationMs),
      },
      eventTime(message, params, this.options.now),
    );
  }

  private completedItem(
    message: Record<string, unknown>,
    params: Record<string, unknown>,
  ): AdapterNormalizedEvent | null {
    const item = asRecord(params.item);
    const providerItemId = text(item?.id);
    const providerTurnId = text(params.turnId);
    if (item === undefined || providerItemId === undefined) return null;
    if (item.type === "contextCompaction" && providerTurnId !== undefined) {
      return this.event(
        "provider.context.compacted",
        { providerTurnId, providerItemId },
        eventTime(message, params, this.options.now),
      );
    }
    if (item.type === "commandExecution") {
      const command = text(item.command);
      const status = lifecycleStatus(item.status);
      if (command === undefined || status === null) {
        return this.providerError("invalid_provider_item", item, message, params);
      }
      const output = item.aggregatedOutput;
      return this.event(
        "provider.command.executed",
        {
          providerItemId,
          commandDigest: digest(command),
          cwdRelative: cwdRelative(this.options.repositoryRoot, item.cwd),
          status,
          exitCode: integer(item.exitCode),
          outputDigest: output === null || output === undefined ? null : digest(output),
          durationMs: integer(item.durationMs),
        },
        eventTime(message, params, this.options.now),
      );
    }
    if (item.type === "fileChange") return this.fileChange(message, params, item, providerItemId);
    if (
      item.type === "mcpToolCall" ||
      item.type === "dynamicToolCall" ||
      item.type === "collabAgentToolCall"
    ) {
      const tool = text(item.tool);
      const server = item.type === "mcpToolCall" ? text(item.server) : undefined;
      const status = lifecycleStatus(item.status);
      if (
        tool === undefined ||
        status === null ||
        (item.type === "mcpToolCall" && server === undefined)
      ) {
        return this.providerError("invalid_provider_item", item, message, params);
      }
      const toolName = item.type === "mcpToolCall" ? `${server}/${tool}` : tool;
      return this.event(
        "provider.tool.called",
        {
          providerItemId,
          toolName,
          inputDigest: digest(item.arguments ?? item.prompt ?? null),
          status,
          durationMs: integer(item.durationMs),
        },
        eventTime(message, params, this.options.now),
      );
    }
    return null;
  }

  private fileChange(
    message: Record<string, unknown>,
    params: Record<string, unknown>,
    item: Record<string, unknown>,
    providerItemId: string,
  ): AdapterNormalizedEvent {
    const changes = Array.isArray(item.changes) ? item.changes : [];
    const records = changes
      .map(asRecord)
      .filter((change): change is Record<string, unknown> => change !== undefined);
    const paths = records.map((change) => repositoryPath(this.options.repositoryRoot, change.path));
    const status = lifecycleStatus(item.status);
    if (paths.length === 0 || paths.some((path) => path === null) || status === null) {
      return this.event(
        "provider.error",
        {
          failureCode: paths.some((path) => path === null)
            ? "unsafe_provider_path"
            : "invalid_provider_item",
          diagnosticDigest: digest(records.map((change) => change.path)),
          retryable: false,
        },
        eventTime(message, params, this.options.now),
      );
    }
    return this.event(
      "provider.file_change.reported",
      {
        providerItemId,
        paths: paths as string[],
        changeKinds: records.map((change) => fileKind(change.kind)),
        status,
        diffDigest: digest(records.map((change) => change.diff)),
      },
      eventTime(message, params, this.options.now),
    );
  }

  private usage(
    message: Record<string, unknown>,
    params: Record<string, unknown>,
  ): AdapterNormalizedEvent | null {
    const providerTurnId = text(params.turnId);
    const tokenUsage = asRecord(params.tokenUsage);
    const total = asRecord(tokenUsage?.total);
    if (providerTurnId === undefined || total === undefined) return null;
    const counts = {
      inputTokens: nonNegativeInteger(total.inputTokens),
      cachedInputTokens: nonNegativeInteger(total.cachedInputTokens),
      outputTokens: nonNegativeInteger(total.outputTokens),
      reasoningOutputTokens: nonNegativeInteger(total.reasoningOutputTokens),
      totalTokens: nonNegativeInteger(total.totalTokens),
    };
    if (Object.values(counts).some((value) => value === null)) {
      return this.providerError("invalid_provider_usage", tokenUsage, message, params);
    }
    return this.event(
      "provider.usage.updated",
      {
        providerTurnId,
        ...counts,
        contextWindow: integer(tokenUsage?.modelContextWindow),
      },
      eventTime(message, params, this.options.now),
    );
  }

  private providerError(
    failureCode: string,
    diagnostic: unknown,
    message: Record<string, unknown>,
    params: Record<string, unknown>,
  ): AdapterNormalizedEvent {
    return this.event(
      "provider.error",
      { failureCode, diagnosticDigest: digest(diagnostic), retryable: false },
      eventTime(message, params, this.options.now),
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
