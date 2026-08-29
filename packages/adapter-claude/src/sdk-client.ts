import type {
  startup,
  Query,
  WarmQuery,
  McpServerConfig,
  SdkPluginConfig,
} from "@anthropic-ai/claude-agent-sdk";

import { AsyncQueue } from "./async-queue.js";
import { createClaudeManagedWriteHooks } from "./sdk-managed-write-hooks.js";
import { ClaudeInputStream, ClaudeReplayTracker } from "./sdk-stream.js";
import {
  ClaudeAdapterError,
  type ClaudeAgentClient,
  type ClaudeAgentClientStartOptions,
  type ClaudeToolUseHandler,
} from "./types.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class ClaudeSdkAgentClient implements ClaudeAgentClient {
  private readonly input = new ClaudeInputStream();
  private readonly output = new AsyncQueue<unknown>();
  private readonly replays: ClaudeReplayTracker;
  private readonly abortController: AbortController;
  private query: Query | undefined;
  private pump: Promise<void> | undefined;
  private closed = false;
  private toolUseHandler: ClaudeToolUseHandler | undefined;

  private constructor(
    private readonly options: ClaudeAgentClientStartOptions,
    private readonly warm: WarmQuery,
    abortController: AbortController,
  ) {
    this.abortController = abortController;
    this.replays = new ClaudeReplayTracker(options.providerSessionId, options.requestTimeoutMs);
  }

  static async connect(
    options: ClaudeAgentClientStartOptions,
    sdkStartup?: typeof startup,
  ): Promise<ClaudeSdkAgentClient> {
    const abortController = new AbortController();
    let warm: WarmQuery;
    let connected: ClaudeSdkAgentClient | undefined;
    try {
      const start = sdkStartup ?? (await import("@anthropic-ai/claude-agent-sdk")).startup;
      const mcpServers: Record<string, McpServerConfig> = {};
      const plugins: SdkPluginConfig[] = [];
      for (const activation of options.capabilityActivations ?? []) {
        const runtime = activation.runtime;
        if (runtime.kind === "provider_plugin") {
          if (runtime.provider !== "claude") {
            throw new ClaudeAdapterError(
              "invalid_request",
              "A provider plugin targets a different provider.",
            );
          }
          plugins.push({ type: "local", path: runtime.pluginRoot, skipMcpDiscovery: true });
        } else if (runtime.kind === "mcp_stdio") {
          const env: Record<string, string> = {};
          for (const name of runtime.credentialNames) {
            const value = process.env[name];
            if (value === undefined) {
              throw new ClaudeAdapterError(
                "capability_activation_failed",
                "A required MCP credential is unavailable.",
              );
            }
            env[name] = value;
          }
          mcpServers[runtime.serverName] = {
            type: "stdio",
            command: runtime.command,
            args: [...runtime.arguments],
            env,
            timeout: runtime.timeoutMs,
            alwaysLoad: true,
          };
        } else {
          const headers: Record<string, string> = {};
          if (runtime.bearerTokenCredential !== null) {
            const value = process.env[runtime.bearerTokenCredential];
            if (value === undefined) {
              throw new ClaudeAdapterError(
                "capability_activation_failed",
                "A required MCP credential is unavailable.",
              );
            }
            headers.Authorization = `Bearer ${value}`;
          }
          mcpServers[runtime.serverName] = {
            type: "http",
            url: runtime.url,
            ...(Object.keys(headers).length === 0 ? {} : { headers }),
            timeout: runtime.timeoutMs,
            alwaysLoad: true,
          };
        }
      }
      warm = await start({
        initializeTimeoutMs: options.requestTimeoutMs,
        options: {
          abortController,
          cwd: options.cwd,
          ...(options.model === undefined ? {} : { model: options.model }),
          ...(options.executable === undefined
            ? {}
            : { pathToClaudeCodeExecutable: options.executable }),
          ...(options.outputFormat === undefined ? {} : { outputFormat: options.outputFormat }),
          sessionId: options.providerSessionId,
          permissionMode: options.permissionMode,
          settingSources: [],
          skills: [],
          strictMcpConfig: true,
          mcpServers,
          plugins,
          disallowedTools: ["Agent", "Task"],
          tools: options.tools ?? { type: "preset", preset: "claude_code" },
          includePartialMessages: false,
          hooks: createClaudeManagedWriteHooks({
            handler: () => connected?.toolUseHandler,
            fail: (error) => {
              if (connected === undefined) {
                throw error;
              }
              return connected.failManagedWrite(error);
            },
          }),
          canUseTool: async () => ({
            behavior: "deny" as const,
            message:
              "This permission request was denied because no Lervo approval bridge is attached.",
          }),
        },
      });
    } catch (error) {
      if (error instanceof ClaudeAdapterError) throw error;
      throw new ClaudeAdapterError(
        "provider_process_failed",
        "The Claude Agent SDK could not be started.",
      );
    }
    connected = new ClaudeSdkAgentClient(options, warm, abortController);
    return connected;
  }

  attachToolUseHandler(handler: ClaudeToolUseHandler): void {
    if (this.toolUseHandler !== undefined) {
      throw new ClaudeAdapterError("invalid_request", "A Claude tool handler is already attached.");
    }
    this.toolUseHandler = handler;
  }

  private failManagedWrite(error: unknown): never {
    const failure =
      error instanceof Error
        ? error
        : new ClaudeAdapterError(
            "provider_protocol_failed",
            "The Claude managed write bridge failed.",
          );
    this.output.fail(failure);
    throw failure;
  }

  async appendContext(content: string): Promise<void> {
    await this.send(content, false);
  }

  async confirmCapabilities(): Promise<void> {
    if (this.query === undefined) {
      throw new ClaudeAdapterError(
        "capability_activation_failed",
        "Claude capability activation was checked before controlled context started the provider stream.",
      );
    }
    try {
      const activations = this.options.capabilityActivations ?? [];
      const expectedMcp = new Set(
        activations.flatMap((activation) =>
          activation.runtime.kind === "mcp_stdio" || activation.runtime.kind === "mcp_http"
            ? [activation.runtime.serverName]
            : [],
        ),
      );
      const statuses = await this.query.mcpServerStatus();
      for (const name of expectedMcp) {
        if (!statuses.some((status) => status.name === name && status.status === "connected")) {
          throw new ClaudeAdapterError(
            "capability_activation_failed",
            "Claude did not report every requested MCP server as connected.",
          );
        }
      }
      const expectedPlugins = activations.filter(
        (activation) => activation.runtime.kind === "provider_plugin",
      );
      if (expectedPlugins.length > 0) {
        const reloaded = await this.query.reloadPlugins();
        if (
          reloaded.error_count !== 0 ||
          expectedPlugins.some((activation) => {
            const runtime = activation.runtime;
            return (
              runtime.kind !== "provider_plugin" ||
              !reloaded.plugins.some(
                (plugin) =>
                  plugin.path === runtime.pluginRoot && plugin.version === activation.version,
              )
            );
          })
        ) {
          throw new ClaudeAdapterError(
            "capability_activation_failed",
            "Claude did not report every requested provider plugin as loaded.",
          );
        }
      }
    } catch (error) {
      if (error instanceof ClaudeAdapterError) throw error;
      throw new ClaudeAdapterError(
        "capability_activation_failed",
        "Claude capability activation could not be confirmed.",
      );
    }
  }

  async startTurn(turnId: string, instructions: string): Promise<void> {
    await this.send(instructions, true, turnId);
  }

  async interrupt(): Promise<void> {
    if (this.query === undefined) return;
    try {
      await this.query.interrupt();
    } catch {
      throw new ClaudeAdapterError(
        "provider_process_failed",
        "The Claude turn could not be interrupted.",
      );
    }
  }

  messages(signal: AbortSignal): AsyncIterable<unknown> {
    return this.output.iterate(signal);
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.input.end();
    try {
      if (this.query === undefined) {
        this.warm.close();
      } else {
        await this.finishQueryWithinDeadline();
      }
    } catch {
      this.abortController.abort();
      throw new ClaudeAdapterError(
        "provider_process_failed",
        "The Claude Agent SDK could not be stopped.",
      );
    } finally {
      this.abortController.abort();
      this.output.end();
      this.replays.fail(
        new ClaudeAdapterError(
          "session_stopped",
          "The Claude session ended before acknowledging input.",
        ),
      );
    }
  }

  private async finishQueryWithinDeadline(): Promise<void> {
    const operation = (async () => {
      await this.query!.return(undefined);
      await this.pump;
    })();
    void operation.catch(() => undefined);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        operation,
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(
            () => reject(new Error("Claude shutdown deadline exceeded")),
            this.options.requestTimeoutMs,
          );
          timer.unref?.();
        }),
      ]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  private async send(content: string, shouldQuery: boolean, messageId?: string): Promise<void> {
    if (this.closed)
      throw new ClaudeAdapterError("session_stopped", "The Claude session has already ended.");
    const uuid = messageId ?? this.options.createMessageId();
    if (!UUID_PATTERN.test(uuid)) {
      throw new ClaudeAdapterError(
        "invalid_request",
        "The Claude input message ID must be a UUID.",
      );
    }
    const accepted = this.replays.expect(uuid, content, shouldQuery);
    this.ensureStream();
    this.input.push({
      type: "user",
      message: {
        role: "user",
        content: [{ type: "text", text: content }],
      },
      parent_tool_use_id: null,
      isSynthetic: !shouldQuery,
      shouldQuery,
      uuid: uuid as `${string}-${string}-${string}-${string}-${string}`,
      session_id: this.options.providerSessionId,
    });
    await accepted;
  }

  private ensureStream(): void {
    if (this.query !== undefined) return;
    this.query = this.warm.query(this.input);
    this.pump = this.pumpMessages(this.query);
  }

  private async pumpMessages(query: Query): Promise<void> {
    try {
      for await (const message of query) {
        const internalContextAcknowledgement = this.replays.accept(message);
        if (!internalContextAcknowledgement) this.output.push(message);
      }
      if (!this.closed) {
        throw new ClaudeAdapterError(
          "provider_process_failed",
          "The Claude event stream ended unexpectedly.",
        );
      }
    } catch (error) {
      const failure =
        error instanceof ClaudeAdapterError
          ? error
          : new ClaudeAdapterError(
              "provider_process_failed",
              "The Claude event stream could not be read.",
            );
      this.replays.fail(failure);
      this.output.fail(failure);
    }
  }
}
